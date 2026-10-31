import { KEY_REF, MAX_BODY_BYTES } from "./constants.mjs";
import { PAYLOAD_TOO_LARGE, isLoopbackRequest, isTrustedApiRequest, readJsonBody, safeErrorMessage, writeError, writeJson } from "./fence.mjs";
import { describeGroqKey } from "./provider.mjs";
import { mergeSettings, normalizeSettings, readSettings, writeSettings } from "./settings.mjs";
import { canSelectVoiceProvider, readVoiceInputStatus, selectGroqProvider } from "./voiceInput.mjs";
// src/api.ts
/**
* A browser-facing failure with an HTTP status and stable code.
* Messages here are fixed strings; callers never pass secrets in.
*/
var ApiFailure = class extends Error {
	constructor(status, code, message) {
		super(message);
		this.name = "ApiFailure";
		this.status = status;
		this.code = code;
	}
};
function isPlainObject(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
/**
* Resolve the connection service for browser-session verification.
*
* @param ctx plugin context.
* @returns the service, or undefined when this profile has none.
*/
function resolveConnection(ctx) {
	if (ctx === null || typeof ctx !== "object") return void 0;
	const candidate = ctx;
	let direct;
	try {
		direct = candidate.connection;
	} catch {}
	if (direct && typeof direct.requestRejection === "function") return direct;
	if (typeof candidate.get === "function") try {
		const service = candidate.get("connection");
		if (service && typeof service.requestRejection === "function") return service;
	} catch {}
}
/**
* Require a live DSH browser session (or API credential) for a request.
*
* @param ctx plugin context.
* @param req incoming request.
* @returns undefined when admitted, otherwise the HTTP status to return.
*/
function sessionRejection(ctx, req) {
	const connection = resolveConnection(ctx);
	if (!connection || typeof connection.requestRejection !== "function") return 403;
	let rejection;
	try {
		rejection = connection.requestRejection(req);
	} catch {
		return 403;
	}
	if (rejection === void 0) return void 0;
	return rejection === 401 ? 401 : 403;
}
function ok(value) {
	return {
		status: 200,
		body: {
			ok: true,
			value
		}
	};
}
/**
* Execute one parsed API action.
*
* Returns an HTTP status plus the exact response envelope; throws
* {@link ApiFailure} for a client-visible failure.
*
* @param ctx host context.
* @param payload parsed request body carrying `action`.
* @param options environment override.
* @returns the response envelope.
*/
async function dispatchAction(ctx, payload, options = {}) {
	const env = options.env || process.env;
	const action = isPlainObject(payload) ? payload.action : void 0;
	if (action === "status") {
		const key = await describeGroqKey(ctx, env);
		return ok({
			configured: key.configured,
			source: key.source,
			writable: key.writable,
			envVar: KEY_REF,
			settings: readSettings(),
			voice: readVoiceInputStatus(ctx)
		});
	}
	if (action === "select-provider") {
		if (!canSelectVoiceProvider(ctx)) throw new ApiFailure(409, "voice-unavailable", "Groq Whisper is not available in the voice-input picker");
		let voice;
		try {
			voice = await selectGroqProvider(ctx);
		} catch {
			throw new ApiFailure(500, "voice-select-failed", "Could not select Groq Whisper for voice input");
		}
		return ok({ voice });
	}
	if (action === "get-settings") return ok({ settings: readSettings() });
	if (action === "set-settings") {
		if (!isPlainObject(payload) || !isPlainObject(payload.patch)) throw new ApiFailure(400, "bad-request", "patch must be a plain object");
		const settings = mergeSettings(readSettings(), payload.patch);
		try {
			writeSettings(settings);
		} catch {
			throw new ApiFailure(500, "settings-write-failed", "Could not save settings");
		}
		return ok({ settings: normalizeSettings(settings) });
	}
	if (action === "list-models") return ok(await listModels(ctx));
	throw new ApiFailure(404, "unknown-action", "Unknown action");
}
/**
* Flatten the DSH model routes into provider/model pairs for the polish picker.
*
* One broken adapter must not hide every other route, so a failing provider is
* skipped while the rest of the list is still returned.
*
* @param ctx host context carrying `llm`.
* @returns the selectable routes, possibly empty.
*/
async function listModels(ctx) {
	const routes = [];
	const llm = ctx !== null && typeof ctx === "object" ? ctx.llm : void 0;
	if (llm === null || typeof llm !== "object") return routes;
	const service = llm;
	if (typeof service.listProviders !== "function" || typeof service.listModels !== "function") return routes;
	let providers = [];
	try {
		providers = service.listProviders();
	} catch {
		providers = [];
	}
	for (const provider of Array.isArray(providers) ? providers : []) {
		if (!isPlainObject(provider) || typeof provider.id !== "string") continue;
		let models = [];
		try {
			models = await service.listModels(provider.id);
		} catch {
			continue;
		}
		for (const model of Array.isArray(models) ? models : []) {
			if (!isPlainObject(model) || typeof model.id !== "string") continue;
			routes.push({
				provider: provider.id,
				providerName: typeof provider.name === "string" ? provider.name : provider.id,
				model: model.id,
				modelName: typeof model.name === "string" ? model.name : model.id
			});
		}
	}
	return routes;
}
function contentTypeOf(req) {
	const value = req.headers["content-type"];
	return typeof value === "string" ? value.toLowerCase() : "";
}
/**
* Handle one HTTP request against the browser API.
*
* @param ctx host context.
* @param req incoming request.
* @param res response.
* @param options trusted hosts and environment override.
*/
async function handleApiRequest(ctx, req, res, options = {}) {
	try {
		if (!isTrustedApiRequest(req, options.trustedHosts || [])) {
			writeError(res, 403, "forbidden", "Forbidden");
			return;
		}
		if (resolveConnection(ctx) !== void 0 || !isLoopbackRequest(req)) {
			const rejection = sessionRejection(ctx, req);
			if (rejection !== void 0) {
				writeError(res, rejection, rejection === 401 ? "authentication-required" : "forbidden", rejection === 401 ? "Authentication required: open the DSH Web UI from its printed URL." : "Untrusted request");
				return;
			}
		}
		if (req.method !== "POST") {
			writeError(res, 405, "method-error", "Method not allowed");
			return;
		}
		if (!contentTypeOf(req).startsWith("application/json")) {
			writeError(res, 415, "unsupported-media-type", "Content-Type must be application/json");
			return;
		}
		const declared = Number(req.headers["content-length"]);
		if (Number.isFinite(declared) && declared > 65536) {
			res.setHeader("connection", "close");
			writeError(res, 413, "payload-too-large", "Request body too large");
			return;
		}
		const payload = await readJsonBody(req, MAX_BODY_BYTES);
		if (payload === PAYLOAD_TOO_LARGE) {
			res.setHeader("connection", "close");
			writeError(res, 413, "payload-too-large", "Request body too large");
			return;
		}
		if (!isPlainObject(payload) || typeof payload.action !== "string") {
			writeError(res, 400, "bad-request", "Request body must carry a string action");
			return;
		}
		const result = await dispatchAction(ctx, payload, options);
		writeJson(res, result.status, result.body);
	} catch (error) {
		if (error instanceof ApiFailure) {
			writeError(res, error.status, error.code, error.message);
			return;
		}
		console.error("[dsh-groq-speech] API error:", safeErrorMessage(error instanceof Error ? error.message : void 0));
		writeError(res, 500, "internal", "Internal error");
	}
}
/**
* Build the `webServer` prefix handler.
*
* @param ctx host context.
* @param options trusted hosts and environment override.
* @returns a prefix-route handler.
*/
function createApiHandler(ctx, options = {}) {
	return (req, res) => handleApiRequest(ctx, req, res, options);
}
export { ApiFailure, createApiHandler, dispatchAction, handleApiRequest };
