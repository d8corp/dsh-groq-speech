/**
 * The Groq Whisper `SpeechProvider` and the Groq credential helpers.
 *
 * The API key is resolved per transcription through `ctx.credentials`, never
 * cached, and never included in an error message. If the credentials service
 * is absent (defensive only — the plugin injects it), the environment variable
 * is used as a fallback.
 */
import type { GroqSpeechSettings, KeyStatus } from './contracts';
/** Metadata advertised to the official voice-input picker. */
export interface SpeechProviderInfo {
    id: string;
    name: string;
    location: 'cloud';
    languages: string[];
}
/** One recording handed to a provider. */
export interface TranscriptionInput {
    audio?: unknown;
    language?: unknown;
}
/** Result of one transcription. */
export interface TranscriptionResult {
    text: string;
    audioSeconds: number;
    inferenceSeconds: number;
}
/** The slice of the speech registry this plugin implements. */
export interface SpeechProvider {
    info: SpeechProviderInfo;
    transcribe(input: TranscriptionInput, signal?: AbortSignal): Promise<TranscriptionResult>;
}
/**
 * Resolve the branded credential reference lazily, so this module stays
 * importable in plain Node where the DSH peer package may not resolve.
 *
 * @returns the branded reference, or the raw name as a fallback.
 */
export declare function credentialReference(): Promise<unknown>;
/**
 * Resolve the key for one operation. A stored value outranks the environment
 * automatically; the environment is read only when no credentials service
 * exists at all.
 *
 * @param ctx host context.
 * @param env environment fallback.
 * @returns the key, or `''` when unconfigured.
 */
export declare function resolveGroqKey(ctx: unknown, env?: NodeJS.ProcessEnv): Promise<string>;
/**
 * Map a credential source layer onto the UI vocabulary.
 *
 * @param source provider-defined layer id (`file`, `env`, …).
 * @returns `'stored'`, `'env'`, or null for an unknown layer.
 */
export declare function credentialSource(source: unknown): 'stored' | 'env' | null;
/**
 * Describe the key for the settings UI without exposing any part of its value.
 *
 * @param ctx host context.
 * @param env environment fallback.
 * @returns presence, source and writability only.
 */
export declare function describeGroqKey(ctx: unknown, env?: NodeJS.ProcessEnv): Promise<KeyStatus>;
/**
 * Report whether a key exists, without exposing any part of its value.
 *
 * @param ctx host context.
 * @param env environment fallback.
 * @returns true when a key is available.
 */
export declare function isGroqKeyConfigured(ctx: unknown, env?: NodeJS.ProcessEnv): Promise<boolean>;
/**
 * Pick the language hint for one request: the caller's explicit choice wins,
 * then the plugin setting; `auto` everywhere means "let Whisper detect".
 *
 * @param inputLanguage language supplied with the recording.
 * @param settingsLanguage stored language hint.
 * @returns a normalized hint or `''`.
 */
export declare function resolveLanguage(inputLanguage: unknown, settingsLanguage: unknown): string;
export interface ProviderOptions {
    /** Environment used for the API base and the key fallback. */
    env?: NodeJS.ProcessEnv;
    /** Injectable fetch for offline tests. */
    fetchImpl?: typeof fetch;
    /** Settings reader override (tests). */
    read?: () => GroqSpeechSettings;
}
/**
 * Create the Groq Whisper provider registered into `ctx.speechToText`.
 *
 * @param ctx host context (credentials, llm).
 * @param options environment, fetch and settings overrides for tests.
 * @returns the speech provider.
 */
export declare function createProvider(ctx: unknown, options?: ProviderOptions): SpeechProvider;
