/** Shared host-side constants for dsh-groq-speech. */
import type { GroqSpeechSettings, WhisperModel } from './contracts';
/** Provider id registered into ctx.speechToText. */
export declare const PROVIDER_ID = "groq-whisper";
/** Provider display name shown in the official voice-input picker. */
export declare const PROVIDER_NAME = "Groq Whisper";
/** Same-origin browser API prefix. */
export declare const API_PREFIX = "/groq-speech/api";
/** Credential reference used for the Groq key (stored value outranks env). */
export declare const KEY_REF = "GROQ_API_KEY";
/** Groq's OpenAI-compatible base URL; tests override via GROQ_SPEECH_API_BASE. */
export declare const DEFAULT_API_BASE = "https://api.groq.com/openai/v1";
/** This package's name as the profile manifest declares it. */
export declare const PACKAGE_NAME = "dsh-groq-speech";
/** Plugin data directory name under the DSH home. */
export declare const PLUGIN_DIR_NAME = "dsh-groq-speech";
/** Settings file name inside the plugin directory. */
export declare const SETTINGS_FILENAME = "groq-speech.json";
/**
 * Settings file name used by 0.1.0 directly inside `$DSH_HOME`. It is read
 * when the plugin-directory file does not exist yet and is never written back.
 */
export declare const LEGACY_SETTINGS_FILENAME = "groq-speech.json";
/** Selectable transcription models. */
export declare const MODELS: readonly WhisperModel[];
/** Default transcription model (fast + cheap on the free tier). */
export declare const DEFAULT_MODEL: WhisperModel;
/** Picker labels for {@link MODELS}, shared by the settings UI. */
export declare const MODEL_OPTIONS: ReadonlyArray<{
    value: WhisperModel;
    label: string;
}>;
/** Language hints advertised to the picker; `auto` lets Whisper detect. */
export declare const LANGUAGES: readonly string[];
/** Default polish prompt: fix the transcript, never rewrite its meaning. */
export declare const DEFAULT_POLISH_PROMPT: string;
/** Maximum length of a stored custom polish prompt. */
export declare const MAX_PROMPT_CHARS = 4000;
/** Maximum accepted size of one browser API request body. */
export declare const MAX_BODY_BYTES: number;
/** Per-request Groq timeout. */
export declare const GROQ_TIMEOUT_MS = 60000;
/** Per-request polish timeout. */
export declare const POLISH_TIMEOUT_MS = 45000;
/** Default empty settings document. */
export declare const DEFAULT_SETTINGS: Readonly<GroqSpeechSettings>;
