/**
 * The Groq Whisper `SpeechProvider` and the Groq credential helpers.
 *
 * The API key is resolved per transcription through `ctx.credentials`, never
 * cached, and never included in an error message. If the credentials service
 * is absent (defensive only — the plugin injects it), the environment variable
 * is used as a fallback.
 */

import { KEY_REF, LANGUAGES, PROVIDER_ID, PROVIDER_NAME } from './constants'
import type { GroqSpeechSettings, KeyStatus } from './contracts'
import {
  normalizeLanguage,
  resolveApiBase,
  transcribeWithGroq,
  wavDurationSeconds,
} from './groq'
import { polishTranscript, resolvePolishPrompt } from './polish'
import { readSettings } from './settings'

/** Module id resolved lazily so host files load without DSH installed. */
const DSH_CREDENTIALS_MODULE = '@deepseek-ai/dsh-credentials'

interface CredentialsLike {
  resolve (ref: unknown): Promise<unknown>
  describe (ref: unknown): Promise<unknown>
}

interface CredentialResolution {
  value?: unknown
}

interface CredentialDescription {
  configured?: unknown
  source?: unknown
  writable?: unknown
}

/** Metadata advertised to the official voice-input picker. */
export interface SpeechProviderInfo {
  id: string
  name: string
  location: 'cloud'
  languages: string[]
}

/** One recording handed to a provider. */
export interface TranscriptionInput {
  audio?: unknown
  language?: unknown
}

/** Result of one transcription. */
export interface TranscriptionResult {
  text: string
  audioSeconds: number
  inferenceSeconds: number
}

/** The slice of the speech registry this plugin implements. */
export interface SpeechProvider {
  info: SpeechProviderInfo
  transcribe (input: TranscriptionInput, signal?: AbortSignal): Promise<TranscriptionResult>
}

/** Cached branded reference; `undefined` until the first resolution. */
let referencePromise: Promise<unknown> | undefined

/**
 * Resolve the branded credential reference lazily, so this module stays
 * importable in plain Node where the DSH peer package may not resolve.
 *
 * @returns the branded reference, or the raw name as a fallback.
 */
export function credentialReference (): Promise<unknown> {
  if (referencePromise === undefined) {
    referencePromise = import(DSH_CREDENTIALS_MODULE)
      .then((module) => {
        const factory = (module as { credentialRef?: unknown }).credentialRef

        return typeof factory === 'function' ? factory(KEY_REF) : KEY_REF
      })
      .catch(() => KEY_REF)
  }

  return referencePromise
}

function envKey (env: NodeJS.ProcessEnv): string {
  return env !== null && typeof env === 'object' && typeof env.GROQ_API_KEY === 'string'
    ? env.GROQ_API_KEY.trim()
    : ''
}

function resolveCredentials (ctx: unknown): CredentialsLike | undefined {
  if (ctx === null || typeof ctx !== 'object') return undefined

  const credentials = (ctx as { credentials?: unknown }).credentials

  if (credentials === null || typeof credentials !== 'object') return undefined

  return typeof (credentials as CredentialsLike).resolve === 'function' &&
    typeof (credentials as CredentialsLike).describe === 'function'
    ? credentials as CredentialsLike
    : undefined
}

/**
 * Resolve the key for one operation. A stored value outranks the environment
 * automatically; the environment is read only when no credentials service
 * exists at all.
 *
 * @param ctx host context.
 * @param env environment fallback.
 * @returns the key, or `''` when unconfigured.
 */
export async function resolveGroqKey (ctx: unknown, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const credentials = resolveCredentials(ctx)

  if (credentials !== undefined) {
    const resolved = await credentials.resolve(await credentialReference())

    return resolved !== null && typeof resolved === 'object' && typeof (resolved as CredentialResolution).value === 'string'
      ? ((resolved as CredentialResolution).value as string).trim()
      : ''
  }

  return envKey(env)
}

/**
 * Map a credential source layer onto the UI vocabulary.
 *
 * @param source provider-defined layer id (`file`, `env`, …).
 * @returns `'stored'`, `'env'`, or null for an unknown layer.
 */
export function credentialSource (source: unknown): 'stored' | 'env' | null {
  if (typeof source !== 'string' || source === '') return null
  if (source === 'env' || source.endsWith('-env')) return 'env'

  return 'stored'
}

/**
 * Describe the key for the settings UI without exposing any part of its value.
 *
 * @param ctx host context.
 * @param env environment fallback.
 * @returns presence, source and writability only.
 */
export async function describeGroqKey (ctx: unknown, env: NodeJS.ProcessEnv = process.env): Promise<KeyStatus> {
  const credentials = resolveCredentials(ctx)

  if (credentials !== undefined) {
    const info = await credentials.describe(await credentialReference())
    const configured = info !== null && typeof info === 'object' && (info as CredentialDescription).configured === true

    return {
      configured,
      source: configured ? (credentialSource((info as CredentialDescription).source) || 'stored') : null,
      writable: info !== null && typeof info === 'object' && (info as CredentialDescription).writable === true,
    }
  }

  const key = envKey(env)

  return {
    configured: key !== '',
    source: key !== '' ? 'env' : null,
    writable: false,
  }
}

/**
 * Report whether a key exists, without exposing any part of its value.
 *
 * @param ctx host context.
 * @param env environment fallback.
 * @returns true when a key is available.
 */
export async function isGroqKeyConfigured (ctx: unknown, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  return (await describeGroqKey(ctx, env)).configured
}

/**
 * Pick the language hint for one request: the caller's explicit choice wins,
 * then the plugin setting; `auto` everywhere means "let Whisper detect".
 *
 * @param inputLanguage language supplied with the recording.
 * @param settingsLanguage stored language hint.
 * @returns a normalized hint or `''`.
 */
export function resolveLanguage (inputLanguage: unknown, settingsLanguage: unknown): string {
  const explicit = normalizeLanguage(inputLanguage)

  return explicit !== '' ? explicit : normalizeLanguage(settingsLanguage)
}

export interface ProviderOptions {
  /** Environment used for the API base and the key fallback. */
  env?: NodeJS.ProcessEnv
  /** Injectable fetch for offline tests. */
  fetchImpl?: typeof fetch
  /** Settings reader override (tests). */
  read?: () => GroqSpeechSettings
}

/**
 * Create the Groq Whisper provider registered into `ctx.speechToText`.
 *
 * @param ctx host context (credentials, llm).
 * @param options environment, fetch and settings overrides for tests.
 * @returns the speech provider.
 */
export function createProvider (ctx: unknown, options: ProviderOptions = {}): SpeechProvider {
  const env = options.env || process.env
  const fetchImpl = options.fetchImpl
  const read = typeof options.read === 'function' ? options.read : readSettings

  return {
    info: {
      id: PROVIDER_ID,
      name: PROVIDER_NAME,
      location: 'cloud',
      languages: LANGUAGES.slice(),
    },

    async transcribe (input: TranscriptionInput, signal?: AbortSignal): Promise<TranscriptionResult> {
      const settings = read()
      const key = await resolveGroqKey(ctx, env)

      if (key === '') {
        const error = new Error('Groq API key is not configured') as Error & { code: string }

        error.code = 'groq-key-missing'
        throw error
      }

      const audio = input !== null && typeof input === 'object' ? input.audio : undefined

      const audioSeconds = wavDurationSeconds(
        audio !== null && typeof audio === 'object' && typeof (audio as { byteLength?: unknown }).byteLength === 'number'
          ? (audio as { byteLength: number }).byteLength
          : audio !== null && typeof audio === 'object' && typeof (audio as { length?: unknown }).length === 'number'
            ? (audio as { length: number }).length
            : 0,
      )

      const result = await transcribeWithGroq({
        audio,
        apiKey: key,
        model: settings.model,
        language: resolveLanguage(
          input !== null && typeof input === 'object' ? input.language : '',
          settings.language,
        ),
        baseUrl: resolveApiBase(env),
        signal,
        fetchImpl,
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
          signal,
        })
      }

      return {
        text,
        audioSeconds,
        inferenceSeconds: result.inferenceSeconds,
      }
    },
  }
}
