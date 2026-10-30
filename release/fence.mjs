import { MAX_BODY_BYTES } from "./constants.mjs";
// src/fence.ts
/** Sentinel resolved by {@link readJsonBody} when the body exceeds the cap. */
const PAYLOAD_TOO_LARGE = Symbol("payload-too-large");
/**
* Parse a bare `host[:port]` authority into a URL.
*
* @param authority header value or configured entry.
* @returns parsed URL, or undefined when the value is not a bare authority.
*/
function parseAuthority(authority) {
	if (typeof authority !== "string") return void 0;
	const value = authority.trim();
	if (value === "" || /[/?#@\\\s]/.test(value)) return void 0;
	try {
		const url = new URL(`http://${value}`);
		if (url.username !== "" || url.password !== "" || url.pathname !== "/") return void 0;
		return url;
	} catch {
		return;
	}
}
/**
* Whether a hostname names the loopback interface.
*
* @param hostname URL hostname, with or without IPv6 brackets.
* @returns true for `localhost`, `::1` and `127.0.0.0/8`.
*/
function isLoopbackHostname(hostname) {
	if (typeof hostname !== "string" || hostname === "") return false;
	let name = hostname.toLowerCase();
	if (name.startsWith("[") && name.endsWith("]")) name = name.slice(1, -1);
	if (name === "localhost" || name === "::1") return true;
	const parts = (name.startsWith("::ffff:") ? name.slice(7) : name).split(".");
	return parts.length === 4 && parts[0] === "127" && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}
/**
* Canonical text of an authority: hostname plus an explicitly written port.
*
* @param authority bare `host[:port]`.
* @returns the canonical form, or undefined for a malformed authority.
*/
function canonicalAuthority(authority) {
	const url = parseAuthority(authority);
	if (url === void 0) return void 0;
	const explicitPort = /:(\d+)$/.exec(authority.trim());
	return explicitPort === null ? url.hostname : `${url.hostname}:${explicitPort[1]}`;
}
function isTrustedAuthority(authority, hostUrl, trustedHosts) {
	const requestAuthority = canonicalAuthority(authority) || hostUrl.hostname;
	return trustedHosts.some((entry) => {
		const url = parseAuthority(entry);
		if (url === void 0) return false;
		const canonical = canonicalFrom(url, entry);
		return canonical !== url.hostname ? canonical === requestAuthority : url.hostname === hostUrl.hostname;
	});
}
function canonicalFrom(url, authority) {
	const explicitPort = /:(\d+)$/.exec(authority.trim());
	return explicitPort === null ? url.hostname : `${url.hostname}:${explicitPort[1]}`;
}
/**
* Validate and filter `webStartup.trustedHosts` once, at plugin startup.
*
* A malformed user-configured entry must not throw inside every request
* handler; it is reported through `warn` and ignored instead.
*
* @param entries configured trusted host authorities.
* @param warn diagnostic sink.
* @returns usable authorities.
*/
function buildTrustedHosts(entries, warn) {
	const trusted = [];
	for (const entry of Array.isArray(entries) ? entries : []) {
		if (typeof entry !== "string") {
			if (warn) warn("trusted host entry is not a string");
			continue;
		}
		const canonical = canonicalAuthority(entry);
		if (canonical === void 0 || canonical !== entry.trim().toLowerCase()) {
			if (warn) warn(`entry ${JSON.stringify(entry)} is not a bare host[:port] authority`);
			continue;
		}
		trusted.push(entry.trim());
	}
	return trusted;
}
function headersOf(req) {
	return req !== null && typeof req === "object" && "headers" in req && req.headers !== null && typeof req.headers === "object" ? req.headers : {};
}
/**
* Decide whether a request may use the browser API.
*
* Requirements: a parseable Host header on loopback or a trusted authority,
* no `sec-fetch-site: cross-site`, and — when Origin is present — an Origin
* whose host (including port) equals the Host header.
*
* @param req incoming request.
* @param trustedHosts configured non-loopback authorities.
* @returns true when the Host/Origin fence admits the request.
*/
function isTrustedApiRequest(req, trustedHosts = []) {
	if (req === null || typeof req !== "object") return false;
	const headers = headersOf(req);
	const host = typeof headers.host === "string" ? headers.host : void 0;
	if (host === void 0) return false;
	const hostUrl = parseAuthority(host);
	if (hostUrl === void 0) return false;
	if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(host, hostUrl, trustedHosts)) return false;
	const site = headers["sec-fetch-site"];
	if (typeof site === "string" && site.toLowerCase() === "cross-site") return false;
	const origin = headers.origin;
	if (origin === void 0 || origin === "") return true;
	if (typeof origin !== "string") return false;
	try {
		return new URL(origin).host === hostUrl.host;
	} catch {
		return false;
	}
}
/**
* Whether a request targets a loopback authority.
*
* @param req incoming request carrying a Host header.
* @returns true for localhost, ::1 and 127.0.0.0/8 authorities.
*/
function isLoopbackRequest(req) {
	const headers = headersOf(req);
	const host = typeof headers.host === "string" ? headers.host : void 0;
	if (host === void 0) return false;
	const authority = parseAuthority(host);
	return authority !== void 0 && isLoopbackHostname(authority.hostname);
}
/**
* Read and JSON-parse a request body with a hard size cap.
*
* Overflow resolves with {@link PAYLOAD_TOO_LARGE} instead of rejecting, so the
* caller can answer 413 while the socket is still writable.
*
* @param req incoming request.
* @param maxBytes hard body cap.
* @returns the parsed body, null for empty/invalid JSON, or the sentinel.
*/
function readJsonBody(req, maxBytes = MAX_BODY_BYTES) {
	return new Promise((resolve) => {
		const chunks = [];
		let size = 0;
		let settled = false;
		req.on("data", (chunk) => {
			if (settled) return;
			const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8");
			size += buffer.length;
			if (size > maxBytes) {
				settled = true;
				req.pause();
				resolve(PAYLOAD_TOO_LARGE);
				return;
			}
			chunks.push(buffer);
		});
		req.on("end", () => {
			if (settled) return;
			settled = true;
			try {
				const raw = Buffer.concat(chunks).toString("utf8").trim();
				resolve(raw === "" ? null : JSON.parse(raw));
			} catch {
				resolve(null);
			}
		});
		req.on("error", () => {
			if (settled) return;
			settled = true;
			resolve(null);
		});
	});
}
/**
* Write one JSON response. A client that already hung up is ignored rather
* than producing a write-after-end error.
*
* @param res response.
* @param status HTTP status.
* @param value JSON-serializable body.
*/
function writeJson(res, status, value) {
	if (!res || res.writableEnded || res.destroyed) return;
	const body = JSON.stringify(value);
	res.writeHead(status, {
		"content-type": "application/json",
		"cache-control": "no-store"
	});
	res.end(body);
}
/**
* Write one `{ ok: false, error: { code, message } }` response.
*
* @param res response.
* @param status HTTP status.
* @param code stable machine code.
* @param message fixed user-facing message.
*/
function writeError(res, status, code, message) {
	writeJson(res, status, {
		ok: false,
		error: {
			code,
			message
		}
	});
}
/**
* Sanitize an unexpected error message for the log: one line, bounded length.
* Never pass a secret into this helper.
*
* @param value raw value.
* @returns a safe single-line message.
*/
function safeErrorMessage(value) {
	if (typeof value !== "string") return "unknown error";
	const line = value.replace(/[\r\n\t]+/g, " ").trim();
	return line.length > 500 ? `${line.slice(0, 500)}…` : line;
}
export { PAYLOAD_TOO_LARGE, buildTrustedHosts, canonicalAuthority, isLoopbackHostname, isLoopbackRequest, isTrustedApiRequest, parseAuthority, readJsonBody, safeErrorMessage, writeError, writeJson };
