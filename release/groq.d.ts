/**
 * Groq HTTP client for one transcription.
 *
 * Only Node built-ins plus global `fetch`/`FormData`/`Blob` are used. Error
 * messages are fixed strings: a provider response body is never echoed,
 * because a body can contain fragments of the submitted key.
 */
/** An error this module already mapped; never leaks into messages. */
declare const MAPPED: unique symbol;
/** Error shape surfaced by {@link transcribeWithGroq}. */
export interface GroqError extends Error {
    code: string;
    status?: number;
    [MAPPED]?: true;
}
/**
 * Resolve the Groq API base URL, honoring the test/deployment override.
 *
 * A malformed override would make every request fail obscurely, so the
 * documented endpoint is used instead.
 *
 * @param env environment to read `GROQ_SPEECH_API_BASE` from.
 * @returns base URL without a trailing slash.
 */
export declare function resolveApiBase(env?: NodeJS.ProcessEnv): string;
/**
 * Normalize a language hint to Whisper's primary subtag.
 *
 * `auto`, empty, and unrecognized values mean "omit the field".
 *
 * @param value caller or stored language hint.
 * @returns a 2–3 letter lowercase code, or `''`.
 */
export declare function normalizeLanguage(value: unknown): string;
/**
 * Approximate duration of a 16 kHz mono PCM16 WAV recording.
 *
 * @param byteLength WAV byte length.
 * @returns seconds, never negative.
 */
export declare function wavDurationSeconds(byteLength: unknown): number;
/**
 * Fixed, non-leaking message for one Groq HTTP status.
 *
 * @param status HTTP status.
 * @returns a stable user-facing message.
 */
export declare function groqErrorMessage(status: number | undefined): string;
/**
 * Stable machine code paired with {@link groqErrorMessage}.
 *
 * @param status HTTP status.
 * @returns a stable error code.
 */
export declare function groqErrorCode(status: number | undefined): string;
export interface TranscribeOptions {
    /** 16 kHz mono PCM16 WAV bytes. */
    audio?: unknown;
    /** Resolved per call; never logged. */
    apiKey?: string;
    /** Whisper model id. */
    model?: string;
    /** Language hint; `auto` / empty omits the field. */
    language?: string;
    /** API base, defaults to {@link resolveApiBase}. */
    baseUrl?: string;
    /** Caller cancellation. */
    signal?: AbortSignal;
    /** Injectable fetch for offline tests. */
    fetchImpl?: typeof fetch;
    /** Per-call deadline. */
    timeoutMs?: number;
}
export interface TranscribeResult {
    text: string;
    inferenceSeconds: number;
}
/**
 * Transcribe one complete WAV recording through Groq.
 *
 * @param options audio, key, model and request controls.
 * @returns the transcript and inference time.
 */
export declare function transcribeWithGroq(options?: TranscribeOptions): Promise<TranscribeResult>;
export {};
