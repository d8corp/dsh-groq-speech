/**
 * Same-origin request fence and small JSON HTTP helpers.
 *
 * The browser API is reachable from any page that can talk to the DSH Web
 * server, so every request must come from loopback or an explicitly trusted
 * host, must not be a cross-site fetch, and — when the browser sends an Origin
 * header — must target the same origin it came from. Pure Node helpers only:
 * this module is importable in plain Node for the offline test suite.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
/** Sentinel resolved by {@link readJsonBody} when the body exceeds the cap. */
export declare const PAYLOAD_TOO_LARGE: unique symbol;
/**
 * Parse a bare `host[:port]` authority into a URL.
 *
 * @param authority header value or configured entry.
 * @returns parsed URL, or undefined when the value is not a bare authority.
 */
export declare function parseAuthority(authority: unknown): URL | undefined;
/**
 * Whether a hostname names the loopback interface.
 *
 * @param hostname URL hostname, with or without IPv6 brackets.
 * @returns true for `localhost`, `::1` and `127.0.0.0/8`.
 */
export declare function isLoopbackHostname(hostname: unknown): boolean;
/**
 * Canonical text of an authority: hostname plus an explicitly written port.
 *
 * @param authority bare `host[:port]`.
 * @returns the canonical form, or undefined for a malformed authority.
 */
export declare function canonicalAuthority(authority: string): string | undefined;
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
export declare function buildTrustedHosts(entries: unknown, warn?: (message: string) => void): string[];
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
export declare function isTrustedApiRequest(req: unknown, trustedHosts?: string[]): boolean;
/**
 * Whether a request targets a loopback authority.
 *
 * @param req incoming request carrying a Host header.
 * @returns true for localhost, ::1 and 127.0.0.0/8 authorities.
 */
export declare function isLoopbackRequest(req: unknown): boolean;
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
export declare function readJsonBody(req: IncomingMessage, maxBytes?: number): Promise<unknown | typeof PAYLOAD_TOO_LARGE>;
/**
 * Write one JSON response. A client that already hung up is ignored rather
 * than producing a write-after-end error.
 *
 * @param res response.
 * @param status HTTP status.
 * @param value JSON-serializable body.
 */
export declare function writeJson(res: ServerResponse, status: number, value: unknown): void;
/**
 * Write one `{ ok: false, error: { code, message } }` response.
 *
 * @param res response.
 * @param status HTTP status.
 * @param code stable machine code.
 * @param message fixed user-facing message.
 */
export declare function writeError(res: ServerResponse, status: number, code: string, message: string): void;
/**
 * Sanitize an unexpected error message for the log: one line, bounded length.
 * Never pass a secret into this helper.
 *
 * @param value raw value.
 * @returns a safe single-line message.
 */
export declare function safeErrorMessage(value: unknown): string;
