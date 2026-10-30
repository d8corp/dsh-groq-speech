import { DEFAULT_POLISH_PROMPT, POLISH_TIMEOUT_MS } from "./constants.mjs";
// src/polish.ts
/**
* Optional LLM polish pass for a transcript.
*
* Polish runs through DSH's configured model routes (`ctx.llm`), including the
* agent's own Groq provider when one is configured. Every failure — missing
* route, timeout, stream error, even an import failure in a bare Node test —
* returns the raw transcript unchanged: the user's words are never lost.
*/
/** Module id resolved lazily so host files load without DSH installed. */
const DSH_LLM_MODULE = "@deepseek-ai/dsh-llm";
/**
* Resolve the polish system prompt from settings.
*
* A non-empty custom prompt wins; blank falls back to the built-in default.
*
* @param settings settings document (or anything settings-shaped).
* @returns the system prompt.
*/
function resolvePolishPrompt(settings) {
	const polish = settings !== null && typeof settings === "object" ? settings.polish : void 0;
	const custom = polish !== null && typeof polish === "object" && typeof polish.prompt === "string" ? polish.prompt.trim() : "";
	return custom !== "" ? custom : DEFAULT_POLISH_PROMPT;
}
/**
* Read the LLM service from a host context without assuming its full shape.
*
* @param ctx host context.
* @returns the service when it exposes `prepareCall`.
*/
function resolveLlm(ctx) {
	if (ctx === null || typeof ctx !== "object") return void 0;
	const llm = ctx.llm;
	if (llm === null || typeof llm !== "object") return void 0;
	return typeof llm.prepareCall === "function" ? llm : void 0;
}
/**
* Polish one transcript through DSH's configured LLM.
*
* @param options transcript, route, prompt and cancellation controls.
* @returns polished text, or the raw text on any failure.
*/
async function polishTranscript(options = {}) {
	const { ctx, text, provider, model, prompt, signal, timeoutMs = POLISH_TIMEOUT_MS } = options;
	const raw = typeof text === "string" ? text : "";
	if (raw.trim() === "") return raw;
	if (typeof provider !== "string" || provider === "") return raw;
	if (typeof model !== "string" || model === "") return raw;
	const llm = resolveLlm(ctx);
	if (llm === void 0) return raw;
	const system = typeof prompt === "string" && prompt.trim() !== "" ? prompt.trim() : DEFAULT_POLISH_PROMPT;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	const forward = () => controller.abort(signal && signal.reason);
	if (signal) {
		signal.addEventListener("abort", forward, { once: true });
		if (signal.aborted) forward();
	}
	try {
		const prepared = await llm.prepareCall({
			provider,
			model
		}, controller.signal);
		const { createUserMessage } = await import(DSH_LLM_MODULE);
		const message = createUserMessage({
			content: [{
				type: "text",
				text: raw
			}],
			source: { kind: "user" }
		});
		let output = "";
		for await (const chunk of prepared.stream({
			provider,
			model,
			...prepared.config ?? {},
			messages: [message],
			system,
			signal: controller.signal
		})) {
			if (chunk === null || typeof chunk !== "object") continue;
			const value = chunk;
			if (value.type === "text-delta" && typeof value.text === "string") output += value.text;
			else if (value.type === "finish" && value.reason && (value.reason.kind === "error" || value.reason.kind === "aborted")) throw new Error("Polish call failed");
		}
		const polished = output.trim();
		return polished === "" ? raw : polished;
	} catch {
		return raw;
	} finally {
		clearTimeout(timer);
		if (signal) signal.removeEventListener("abort", forward);
	}
}
export { polishTranscript, resolvePolishPrompt };
