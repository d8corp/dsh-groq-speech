/** Shared host-side constants for dsh-groq-speech. */

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

/** Selectable transcription models. */
export const MODELS = [
  'whisper-large-v3-turbo',
  'whisper-large-v3',
  'distil-whisper-large-v3-en'
]

/** Default transcription model (fast + cheap on the free tier). */
export const DEFAULT_MODEL = 'whisper-large-v3-turbo'

/** Language hints advertised to the picker; `auto` lets Whisper detect. */
export const LANGUAGES = [
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
  'ko'
]

/** Default polish prompt: fix the transcript, never rewrite its meaning. */
export const DEFAULT_POLISH_PROMPT = [
  'You are an editor of speech-to-text transcripts.',
  'Fix punctuation, capitalization, and obvious recognition errors,',
  'remove filler words and repetitions.',
  'Do not add new information, do not change the meaning, and do not translate the text.',
  'Return only the corrected text without explanations.'
].join(' ')

/** Maximum accepted size of one browser API request body. */
export const MAX_BODY_BYTES = 64 * 1024

/** Per-request Groq timeout. */
export const GROQ_TIMEOUT_MS = 60_000

/** Per-request polish timeout. */
export const POLISH_TIMEOUT_MS = 45_000

/** Settings file name inside $DSH_HOME. */
export const SETTINGS_FILE = 'groq-speech.json'

/** Default empty settings document. */
export const DEFAULT_SETTINGS = Object.freeze({
  model: DEFAULT_MODEL,
  language: 'auto',
  polish: Object.freeze({
    provider: '',
    model: '',
    prompt: ''
  })
})
