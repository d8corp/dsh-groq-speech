/**
 * Shapes shared by the host API and the browser settings UI.
 *
 * Type-only: importing this module never adds runtime code to either bundle.
 */
/** Recognition model ids accepted by {@link GroqSpeechSettings}. */
export type WhisperModel = 'whisper-large-v3-turbo' | 'whisper-large-v3' | 'distil-whisper-large-v3-en';
/** Optional LLM polish pass applied to a raw transcript. */
export interface PolishSettings {
    /** DSH LLM provider route; empty disables polishing. */
    provider: string;
    /** Model id on that route; empty disables polishing. */
    model: string;
    /** Custom system prompt; empty uses the built-in default. */
    prompt: string;
}
/** Persisted recognition settings. Never contains the Groq API key. */
export interface GroqSpeechSettings {
    model: WhisperModel;
    language: string;
    polish: PolishSettings;
}
/** Where the shared `GROQ_API_KEY` credential comes from. */
export type KeySource = 'stored' | 'env';
/** Presence-only description of the shared Groq credential. */
export interface KeyStatus {
    configured: boolean;
    source: KeySource | null;
    writable: boolean;
}
/**
 * Voice-input provider selection as reported by the official speech service.
 * The selection itself is owned by the official bundle and stored per profile.
 */
export interface VoiceInputStatus {
    /** True when the official speech service returned a provider catalogue. */
    available: boolean;
    /** True when this plugin can switch the selection to Groq Whisper. */
    selectable: boolean;
    /** Currently selected provider id, or null when unknown. */
    providerId: string | null;
    /** Display name of the selected provider, or null. */
    providerName: string | null;
    /** True when Groq Whisper is the selected provider. */
    selected: boolean;
}
/** Response of the `status` action. Never carries key material. */
export interface StatusPayload extends KeyStatus {
    envVar: string;
    settings: GroqSpeechSettings;
    voice: VoiceInputStatus;
}
/** Client-side view of {@link StatusPayload} before the form has loaded. */
export interface ClientStatus extends KeyStatus {
    envVar: string;
    settings: GroqSpeechSettings | null;
    voice: VoiceInputStatus;
}
/** Response of the `get-settings` and `set-settings` actions. */
export interface SettingsPayload {
    settings: GroqSpeechSettings;
}
/** One selectable provider/model pair exposed by the DSH agent. */
export interface ModelRoute {
    provider: string;
    providerName: string;
    model: string;
    modelName: string;
}
