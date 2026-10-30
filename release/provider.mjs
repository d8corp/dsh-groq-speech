import { KEY_REF, LANGUAGES, PROVIDER_ID, PROVIDER_NAME } from "./constants.mjs";
import { normalizeLanguage, resolveApiBase, transcribeWithGroq, wavDurationSeconds } from "./groq.mjs";
import { polishTranscript, resolvePolishPrompt } from "./polish.mjs";
import { readSettings } from "./settings.mjs";
// src/provider.ts
/**
* The Groq Whisper `SpeechProvider` and the Groq credential helpers.
*
* The API key is resolved per transcription through `ctx.credentials`, never
* cached, and never included in an error message. If the credentials service
* is absent (defensive only — the plugin injects it), the environment variable
* is used as a fallback.
*/
/** Module id resolved lazily so host files load without DSH installed. */
const DSH_CREDENTIALS_MODULE = "@deepseek-ai/dsh-credentials";
/** Cached branded reference; `undefined` until the first resolution. */
let referencePromise;
/**
* Resolve the branded credential reference lazily, so this module stays
* importable in plain Node where the DSH peer package may not resolve.
*
* @returns the branded reference, or the raw name as a fallback.
*/
function credentialReference() {
	if (referencePromise === void 0) referencePromise = import(DSH_CREDENTIALS_MODULE).then((module) => {
		const factory = module.credentialRef;
		return typeof factory === "function" ? factory(KEY_REF) : KEY_REF;
	}).catch(() => KEY_REF);
	return referencePromise;
}
function envKey(env) {
	return env !== null && typeof env === "object" && typeof env.GROQ_API_KEY === "string" ? env.GROQ_API_KEY.trim() : "";
}
function resolveCredentials(ctx) {
	if (ctx === null || typeof ctx !== "object") return void 0;
	const credentials = ctx.credentials;
	if (credentials === null || typeof credentials !== "object") return void 0;
	return typeof credentials.resolve === "function" && typeof credentials.describe === "function" ? credentials : void 0;
}
/**
* Resolve the key for one operation. A stored value outranks the environment
* automatically; the environment is read only when no credentials service
* exists at all.
*
* @param ctx host context.
* @param env environment fallback.
* @returns the key, or `''` when unconfigured.
*/
async function resolveGroqKey(ctx, env = process.env) {
	const credentials = resolveCredentials(ctx);
	if (credentials !== void 0) {
		const resolved = await credentials.resolve(await credentialReference());
		return resolved !== null && typeof resolved === "object" && typeof resolved.value === "string" ? resolved.value.trim() : "";
	}
	return envKey(env);
}
/**
* Map a credential source layer onto the UI vocabulary.
*
* @param source provider-defined layer id (`file`, `env`, …).
* @returns `'stored'`, `'env'`, or null for an unknown layer.
*/
function credentialSource(source) {
	if (typeof source !== "string" || source === "") return null;
	if (source === "env" || source.endsWith("-env")) return "env";
	return "stored";
}
/**
* Describe the key for the settings UI without exposing any part of its value.
*
* @param ctx host context.
* @param env environment fallback.
* @returns presence, source and writability only.
*/
async function describeGroqKey(ctx, env = process.env) {
	const credentials = resolveCredentials(ctx);
	if (credentials !== void 0) {
		const info = await credentials.describe(await credentialReference());
		const configured = info !== null && typeof info === "object" && info.configured === true;
		return {
			configured,
			source: configured ? credentialSource(info.source) || "stored" : null,
			writable: info !== null && typeof info === "object" && info.writable === true
		};
	}
	const key = envKey(env);
	return {
		configured: key !== "",
		source: key !== "" ? "env" : null,
		writable: false
	};
}
/**
* Pick the language hint for one request: the caller's explicit choice wins,
* then the plugin setting; `auto` everywhere means "let Whisper detect".
*
* @param inputLanguage language supplied with the recording.
* @param settingsLanguage stored language hint.
* @returns a normalized hint or `''`.
*/
function resolveLanguage(inputLanguage, settingsLanguage) {
	const explicit = normalizeLanguage(inputLanguage);
	return explicit !== "" ? explicit : normalizeLanguage(settingsLanguage);
}
/**
* Create the Groq Whisper provider registered into `ctx.speechToText`.
*
* @param ctx host context (credentials, llm).
* @param options environment, fetch and settings overrides for tests.
* @returns the speech provider.
*/
function createProvider(ctx, options = {}) {
	const env = options.env || process.env;
	const fetchImpl = options.fetchImpl;
	const read = typeof options.read === "function" ? options.read : readSettings;
	return {
		info: {
			id: PROVIDER_ID,
			name: PROVIDER_NAME,
			location: "cloud",
			languages: LANGUAGES.slice()
		},
		async transcribe(input, signal) {
			const settings = read();
			const key = await resolveGroqKey(ctx, env);
			if (key === "") {
				const error = /* @__PURE__ */ new Error("Groq API key is not configured");
				error.code = "groq-key-missing";
				throw error;
			}
			const audio = input !== null && typeof input === "object" ? input.audio : void 0;
			const audioSeconds = wavDurationSeconds(audio !== null && typeof audio === "object" && typeof audio.byteLength === "number" ? audio.byteLength : audio !== null && typeof audio === "object" && typeof audio.length === "number" ? audio.length : 0);
			const result = await transcribeWithGroq({
				audio,
				apiKey: key,
				model: settings.model,
				language: resolveLanguage(input !== null && typeof input === "object" ? input.language : "", settings.language),
				baseUrl: resolveApiBase(env),
				signal,
				fetchImpl
			});
			let text = result.text;
			const polish = settings.polish;
			if (polish.provider !== "" && polish.model !== "") text = await polishTranscript({
				ctx,
				text,
				provider: polish.provider,
				model: polish.model,
				prompt: resolvePolishPrompt(settings),
				signal
			});
			return {
				text,
				audioSeconds,
				inferenceSeconds: result.inferenceSeconds
			};
		}
	};
}
export { createProvider, credentialReference, credentialSource, describeGroqKey, resolveGroqKey, resolveLanguage };
