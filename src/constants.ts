/** Shared host-side constants for dsh-groq-speech. */

import type { GroqSpeechSettings, WhisperModel } from './contracts'

/** Provider id registered into ctx.speechToText. */
export const PROVIDER_ID = 'groq-whisper'

/** Provider display name shown in the official voice-input picker. */
export const PROVIDER_NAME = 'Groq Whisper'

/** Same-origin browser API prefix. */
export const API_PREFIX = '/groq-speech/api'

/** Credential reference used for the Groq key (stored value outranks env). */
export const KEY_REF = 'GROQ_API_KEY'

/** Groq's OpenAI-compatible base URL; tests override via GROQ_SPEECH_API_BASE. */
export const DEFAULT_API_BASE = 'https://api.groq.com/openai/v1'

/** This package's name as the profile manifest declares it. */
export const PACKAGE_NAME = 'dsh-groq-speech'

/** Plugin data directory name under the DSH home. */
export const PLUGIN_DIR_NAME = 'dsh-groq-speech'

/** Settings file name inside the plugin directory. */
export const SETTINGS_FILENAME = 'groq-speech.json'

/**
 * Settings file name used by 0.1.0 directly inside `$DSH_HOME`. It is read
 * when the plugin-directory file does not exist yet and is never written back.
 */
export const LEGACY_SETTINGS_FILENAME = 'groq-speech.json'

/** Selectable transcription models. */
export const MODELS: readonly WhisperModel[] = [
  'whisper-large-v3-turbo',
  'whisper-large-v3',
  'distil-whisper-large-v3-en',
]

/** Default transcription model (fast + cheap on the free tier). */
export const DEFAULT_MODEL: WhisperModel = 'whisper-large-v3-turbo'

/** Picker labels for {@link MODELS}, shared by the settings UI. */
export const MODEL_OPTIONS: ReadonlyArray<{ value: WhisperModel, label: string }> = [
  { value: 'whisper-large-v3-turbo', label: 'whisper-large-v3-turbo (fast, default)' },
  { value: 'whisper-large-v3', label: 'whisper-large-v3 (most accurate)' },
  { value: 'distil-whisper-large-v3-en', label: 'distil-whisper-large-v3-en (English only, fastest)' },
]

/** Language hints advertised to the picker; `auto` lets Whisper detect. */
export const LANGUAGES: readonly string[] = [
  'auto',
  'ru',
  'en',
  'uk',
  'de',
  'fr',
  'es',
  'it',
  'pt',
  'nl',
  'pl',
  'tr',
  'zh',
  'ja',
  'ko',
]

/** Default polish prompt: fix the transcript, never rewrite its meaning. */
export const DEFAULT_POLISH_PROMPT = [
  'You are an editor of speech-to-text transcripts.',
  'Fix punctuation, capitalization, and obvious recognition errors,',
  'remove filler words and repetitions.',
  'Do not add new information, do not change the meaning, and do not translate the text.',
  'Return only the corrected text without explanations.',
].join(' ')

/** Maximum length of a stored custom polish prompt. */
export const MAX_PROMPT_CHARS = 4000

/** Maximum accepted size of one browser API request body. */
export const MAX_BODY_BYTES = 64 * 1024

/** Per-request Groq timeout. */
export const GROQ_TIMEOUT_MS = 60_000

/** Per-request polish timeout. */
export const POLISH_TIMEOUT_MS = 45_000

/** Default empty settings document. */
export const DEFAULT_SETTINGS: Readonly<GroqSpeechSettings> = Object.freeze({
  model: DEFAULT_MODEL,
  language: 'auto',
  polish: Object.freeze({
    provider: '',
    model: '',
    prompt: '',
  }),
})
