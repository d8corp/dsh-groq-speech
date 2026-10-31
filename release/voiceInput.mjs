import { PROVIDER_ID } from "./constants.mjs";
// src/voiceInput.ts
/**
* Read the official voice-input selection and switch it to Groq Whisper.
*
* The official bundle owns the selection (persisted per profile), so this
* module only reports it and offers one explicit action. Every read is
* best-effort: a profile without the voice-input bundle reports
* `available: false` instead of failing the settings page.
*/
function isPlainObject(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
function resolveSpeechService(ctx) {
	if (ctx === null || typeof ctx !== "object") return void 0;
	let service;
	try {
		service = ctx.speechToText;
	} catch {
		return;
	}
	return service !== null && typeof service === "object" ? service : void 0;
}
/**
* Read one detached snapshot; undefined when the service is absent or throws.
*
* @param ctx host context.
* @returns the snapshot, or undefined.
*/
function readSnapshot(ctx) {
	const service = resolveSpeechService(ctx);
	if (service === void 0 || typeof service.snapshot !== "function") return void 0;
	try {
		const snapshot = service.snapshot();
		return isPlainObject(snapshot) ? snapshot : void 0;
	} catch {
		return;
	}
}
/**
* Normalize the provider catalogue to the id/name pairs this plugin needs.
*
* @param snapshot official snapshot.
* @returns the providers, in registration order.
*/
function readProviders(snapshot) {
	const providers = [];
	for (const entry of Array.isArray(snapshot.providers) ? snapshot.providers : []) {
		if (!isPlainObject(entry) || typeof entry.id !== "string" || entry.id === "") continue;
		providers.push({
			id: entry.id,
			name: typeof entry.name === "string" && entry.name !== "" ? entry.name : entry.id
		});
	}
	return providers;
}
/**
* Describe the current voice-input provider selection.
*
* @param ctx host context.
* @returns the selection; `available` is false when it cannot be read.
*/
function readVoiceInputStatus(ctx) {
	const snapshot = readSnapshot(ctx);
	if (snapshot === void 0) return {
		available: false,
		selectable: false,
		providerId: null,
		providerName: null,
		selected: false
	};
	const providers = readProviders(snapshot);
	const selection = isPlainObject(snapshot.selection) ? snapshot.selection : {};
	const providerId = typeof selection.providerId === "string" && selection.providerId !== "" ? selection.providerId : null;
	const selectedProvider = providerId === null ? void 0 : providers.find((provider) => provider.id === providerId);
	const service = resolveSpeechService(ctx);
	return {
		available: true,
		selectable: providers.some((provider) => provider.id === "groq-whisper") && typeof service?.configure === "function",
		providerId,
		providerName: selectedProvider !== void 0 ? selectedProvider.name : providerId,
		selected: providerId === PROVIDER_ID
	};
}
/**
* Check whether the official service is ready to switch to Groq Whisper.
*
* @param ctx host context.
* @returns true when the provider is registered and configure is callable.
*/
function canSelectVoiceProvider(ctx) {
	return readVoiceInputStatus(ctx).selectable;
}
/**
* Make Groq Whisper the selected voice-input provider.
*
* @param ctx host context.
* @returns the selection after the official service applied the change.
*/
async function selectGroqProvider(ctx) {
	const service = resolveSpeechService(ctx);
	if (service === void 0 || typeof service.configure !== "function") throw new Error("Voice input does not support selection");
	await service.configure({ providerId: PROVIDER_ID });
	return readVoiceInputStatus(ctx);
}
export { canSelectVoiceProvider, readVoiceInputStatus, selectGroqProvider };
