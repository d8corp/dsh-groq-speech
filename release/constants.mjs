// src/constants.ts
/** Provider id registered into ctx.speechToText. */
const PROVIDER_ID = "groq-whisper";
/** Provider display name shown in the official voice-input picker. */
const PROVIDER_NAME = "Groq Whisper";
/** Same-origin browser API prefix. */
const API_PREFIX = "/groq-speech/api";
/** Credential reference used for the Groq key (stored value outranks env). */
const KEY_REF = "GROQ_API_KEY";
/** Groq's OpenAI-compatible base URL; tests override via GROQ_SPEECH_API_BASE. */
const DEFAULT_API_BASE = "https://api.groq.com/openai/v1";
/** This package's name as the profile manifest declares it. */
const PACKAGE_NAME = "dsh-groq-speech";
/** Plugin data directory name under the DSH home. */
const PLUGIN_DIR_NAME = "dsh-groq-speech";
/** Settings file name inside the plugin directory. */
const SETTINGS_FILENAME = "groq-speech.json";
/**
* Settings file name used by 0.1.0 directly inside `$DSH_HOME`. It is read
* when the plugin-directory file does not exist yet and is never written back.
*/
const LEGACY_SETTINGS_FILENAME = "groq-speech.json";
/** Selectable transcription models. */
const MODELS = [
	"whisper-large-v3-turbo",
	"whisper-large-v3",
	"distil-whisper-large-v3-en"
];
/** Default transcription model (fast + cheap on the free tier). */
const DEFAULT_MODEL = "whisper-large-v3-turbo";
/** Language hints advertised to the picker; `auto` lets Whisper detect. */
const LANGUAGES = [
	"auto",
	"ru",
	"en",
	"uk",
	"de",
	"fr",
	"es",
	"it",
	"pt",
	"nl",
	"pl",
	"tr",
	"zh",
	"ja",
	"ko"
];
/** Default polish prompt: fix the transcript, never rewrite its meaning. */
const DEFAULT_POLISH_PROMPT = [
	"You are an editor of speech-to-text transcripts.",
	"Fix punctuation, capitalization, and obvious recognition errors,",
	"remove filler words and repetitions.",
	"Do not add new information, do not change the meaning, and do not translate the text.",
	"Return only the corrected text without explanations."
].join(" ");
/** Maximum length of a stored custom polish prompt. */
const MAX_PROMPT_CHARS = 4e3;
/** Maximum accepted size of one browser API request body. */
const MAX_BODY_BYTES = 65536;
/** Per-request Groq timeout. */
const GROQ_TIMEOUT_MS = 6e4;
/** Per-request polish timeout. */
const POLISH_TIMEOUT_MS = 45e3;
/** Default empty settings document. */
const DEFAULT_SETTINGS = Object.freeze({
	model: DEFAULT_MODEL,
	language: "auto",
	polish: Object.freeze({
		provider: "",
		model: "",
		prompt: ""
	})
});
export { API_PREFIX, DEFAULT_API_BASE, DEFAULT_MODEL, DEFAULT_POLISH_PROMPT, DEFAULT_SETTINGS, GROQ_TIMEOUT_MS, KEY_REF, LANGUAGES, LEGACY_SETTINGS_FILENAME, MAX_BODY_BYTES, MAX_PROMPT_CHARS, MODELS, PACKAGE_NAME, PLUGIN_DIR_NAME, POLISH_TIMEOUT_MS, PROVIDER_ID, PROVIDER_NAME, SETTINGS_FILENAME };
