/**
 * Optional LLM polish pass for a transcript.
 *
 * Polish runs through DSH's configured model routes (`ctx.llm`), including the
 * agent's own Groq provider when one is configured. Every failure — missing
 * route, timeout, stream error, even an import failure in a bare Node test —
 * returns the raw transcript unchanged: the user's words are never lost.
 */
/**
 * Resolve the polish system prompt from settings.
 *
 * A non-empty custom prompt wins; blank falls back to the built-in default.
 *
 * @param settings settings document (or anything settings-shaped).
 * @returns the system prompt.
 */
export declare function resolvePolishPrompt(settings: unknown): string;
export interface PolishOptions {
    /** Host context carrying `llm`. */
    ctx?: unknown;
    /** Raw transcript. */
    text?: unknown;
    /** DSH LLM provider route. */
    provider?: unknown;
    /** Model id on that route. */
    model?: unknown;
    /** Custom system prompt; empty uses the default. */
    prompt?: unknown;
    /** Caller cancellation. */
    signal?: AbortSignal;
    /** Per-call deadline. */
    timeoutMs?: number;
}
/**
 * Polish one transcript through DSH's configured LLM.
 *
 * @param options transcript, route, prompt and cancellation controls.
 * @returns polished text, or the raw text on any failure.
 */
export declare function polishTranscript(options?: PolishOptions): Promise<string>;
