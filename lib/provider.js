/**
 * The Groq Whisper `SpeechProvider` and the Groq credential helpers.
 *
 * The API key is resolved per transcription through `ctx.credentials`, never
 * cached, and never included in an error message. If the credentials service
 * is absent (defensive only — the plugin injects it), the environment variable
 * is used as a fallback.
 */

import {
  KEY_REF,
  LANGUAGES,
  PROVIDER_ID,
  PROVIDER_NAME
} from './constants.js'
import {
  normalizeLanguage,
  resolveApiBase,
  transcribeWithGroq,
  wavDurationSeconds
} from './groq.js'
import { polishTranscript, resolvePolishPrompt } from './polish.js'
import { readSettings } from './settings.js'

/** Cached branded reference; `null` means the DSH package was unreachable. */
let referencePromise

/**
 * Resolve the branded credential reference lazily, so this module stays
 * importable in plain Node where the DSH peer package may not resolve.
 * @returns {Promise<unknown>} branded reference, or the raw name as fallback.
 */
export function credentialReference () {
  if (referencePromise === undefined) {
    referencePromise = import('@deepseek-ai/dsh-credentials')
      .then((module) => (typeof module.credentialRef === 'function' ? module.credentialRef(KEY_REF) : KEY_REF))
      .catch(() => KEY_REF)
  }
  return referencePromise
}

/** @param {unknown} env @returns {string} */
function envKey (env) {
  return env !== null && typeof env === 'object' && typeof env.GROQ_API_KEY === 'string'
    ? env.GROQ_API_KEY.trim()
    : ''
}

/**
 * Resolve the key for one operation. A stored value outranks the environment
 * automatically; the environment is read only when no credentials service
 * exists at all.
 * @param {object} ctx
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<string>} the key, or `''` when unconfigured.
 */
export async function resolveGroqKey (ctx, env = process.env) {
  const credentials = ctx !== null && typeof ctx === 'object' ? ctx.credentials : undefined
  if (credentials !== null && typeof credentials === 'object' && typeof credentials.resolve === 'function') {
    const resolved = await credentials.resolve(await credentialReference())
    return resolved !== null && typeof resolved === 'object' && typeof resolved.value === 'string'
      ? resolved.value.trim()
      : ''
  }
  return envKey(env)
}

/**
 * Map a credential source layer onto the UI vocabulary.
 * @param {unknown} source - provider-defined layer id (`file`, `env`, …).
 * @returns {'stored' | 'env' | null}
 */
export function credentialSource (source) {
  if (typeof source !== 'string' || source === '') return null
  if (source === 'env' || source.endsWith('-env')) return 'env'
  return 'stored'
}

/**
 * Describe the key for the settings UI without exposing any part of its value.
 * @param {object} ctx
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<{configured: boolean, source: 'stored' | 'env' | null, writable: boolean}>}
 */
export async function describeGroqKey (ctx, env = process.env) {
  const credentials = ctx !== null && typeof ctx === 'object' ? ctx.credentials : undefined
  if (credentials !== null && typeof credentials === 'object' && typeof credentials.describe === 'function') {
    const info = await credentials.describe(await credentialReference())
    const configured = info !== null && typeof info === 'object' && info.configured === true
    return {
      configured,
      source: configured ? (credentialSource(info.source) || 'stored') : null,
      writable: info !== null && typeof info === 'object' && info.writable === true
    }
  }

  const key = envKey(env)
  return {
    configured: key !== '',
    source: key !== '' ? 'env' : null,
    writable: false
  }
}

/**
 * Report whether a key exists, without exposing any part of its value.
 * @param {object} ctx
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<boolean>}
 */
export async function isGroqKeyConfigured (ctx, env = process.env) {
  return (await describeGroqKey(ctx, env)).configured
}

/**
 * Pick the language hint for one request: the caller's explicit choice wins,
 * then the plugin setting; `auto` everywhere means "let Whisper detect".
 * @param {unknown} inputLanguage
 * @param {unknown} settingsLanguage
 * @returns {string}
 */
export function resolveLanguage (inputLanguage, settingsLanguage) {
  const explicit = normalizeLanguage(inputLanguage)
  return explicit !== '' ? explicit : normalizeLanguage(settingsLanguage)
}

/**
 * Create the Groq Whisper provider registered into `ctx.speechToText`.
 * @param {object} ctx - host context (credentials, llm).
 * @param {object} [options]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {typeof fetch} [options.fetchImpl] - injectable for offline tests.
 * @param {() => object} [options.read] - settings reader override (tests).
 * @returns {import('@deepseek-ai/dsh-experimental-speech-to-text').SpeechProvider}
 */
export function createProvider (ctx, options = {}) {
  const env = options.env || process.env
  const fetchImpl = options.fetchImpl
  const read = typeof options.read === 'function' ? options.read : readSettings

  return {
    info: {
      id: PROVIDER_ID,
      name: PROVIDER_NAME,
      location: 'cloud',
      languages: LANGUAGES.slice()
    },

    async transcribe (input, signal) {
      const settings = read()

      const key = await resolveGroqKey(ctx, env)
      if (key === '') {
        const error = new Error('Groq API key is not configured')
        error.code = 'groq-key-missing'
        throw error
      }

      const audio = input !== null && typeof input === 'object' ? input.audio : undefined
      const audioSeconds = wavDurationSeconds(
        audio !== null && typeof audio === 'object' && typeof audio.byteLength === 'number'
          ? audio.byteLength
          : audio !== null && typeof audio === 'object' && typeof audio.length === 'number'
            ? audio.length
            : 0
      )

      const result = await transcribeWithGroq({
        audio,
        apiKey: key,
        model: settings.model,
        language: resolveLanguage(
          input !== null && typeof input === 'object' ? input.language : '',
          settings.language
        ),
        baseUrl: resolveApiBase(env),
        signal,
        fetchImpl
      })

      let text = result.text
      const polish = settings.polish
      if (polish.provider !== '' && polish.model !== '') {
        text = await polishTranscript({
          ctx,
          text,
          provider: polish.provider,
          model: polish.model,
          prompt: resolvePolishPrompt(settings),
          signal
        })
      }

      return {
        text,
        audioSeconds,
        inferenceSeconds: result.inferenceSeconds
      }
    }
  }
}
