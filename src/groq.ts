/**
 * Groq HTTP client for one transcription.
 *
 * Only Node built-ins plus global `fetch`/`FormData`/`Blob` are used. Error
 * messages are fixed strings: a provider response body is never echoed,
 * because a body can contain fragments of the submitted key.
 */

import { DEFAULT_API_BASE, GROQ_TIMEOUT_MS } from './constants'

/** An error this module already mapped; never leaks into messages. */
const MAPPED = Symbol('groq-mapped-error')

/** Error shape surfaced by {@link transcribeWithGroq}. */
export interface GroqError extends Error {
  code: string
  status?: number
  [MAPPED]?: true
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
export function resolveApiBase (env: NodeJS.ProcessEnv = process.env): string {
  const override = env && typeof env.GROQ_SPEECH_API_BASE === 'string'
    ? env.GROQ_SPEECH_API_BASE.trim()
    : ''

  const base = override !== '' ? override : DEFAULT_API_BASE

  if (!/^https?:\/\/[^\s]+$/i.test(base)) return DEFAULT_API_BASE

  return base.replace(/\/+$/, '')
}

/**
 * Normalize a language hint to Whisper's primary subtag.
 *
 * `auto`, empty, and unrecognized values mean "omit the field".
 *
 * @param value caller or stored language hint.
 * @returns a 2–3 letter lowercase code, or `''`.
 */
export function normalizeLanguage (value: unknown): string {
  if (typeof value !== 'string') return ''

  const primary = value.trim().toLowerCase().split(/[-_]/)[0]

  if (primary === '' || primary === 'auto') return ''

  return /^[a-z]{2,3}$/.test(primary) ? primary : ''
}

/**
 * Approximate duration of a 16 kHz mono PCM16 WAV recording.
 *
 * @param byteLength WAV byte length.
 * @returns seconds, never negative.
 */
export function wavDurationSeconds (byteLength: unknown): number {
  if (typeof byteLength !== 'number' || !Number.isFinite(byteLength) || byteLength <= 0) return 0

  return byteLength / 32000
}

/**
 * Fixed, non-leaking message for one Groq HTTP status.
 *
 * @param status HTTP status.
 * @returns a stable user-facing message.
 */
export function groqErrorMessage (status: number | undefined): string {
  if (status === 401 || status === 403) return 'Groq rejected the API key'
  if (status === 429) return 'Groq rate limit reached'
  if (typeof status === 'number' && status >= 500 && status <= 599) return 'Groq is unavailable'

  return 'Groq request failed'
}

/**
 * Stable machine code paired with {@link groqErrorMessage}.
 *
 * @param status HTTP status.
 * @returns a stable error code.
 */
export function groqErrorCode (status: number | undefined): string {
  if (status === 401 || status === 403) return 'groq-auth'
  if (status === 429) return 'groq-rate-limit'
  if (typeof status === 'number' && status >= 500 && status <= 599) return 'groq-unavailable'

  return 'groq-http'
}

function failure (message: string, code: string, status?: number): GroqError {
  const error = new Error(message) as GroqError

  error.code = code

  if (typeof status === 'number') error.status = status

  error[MAPPED] = true

  return error
}

/**
 * Wire a caller signal and the per-call timeout to one AbortController.
 *
 * @param signal caller cancellation, when any.
 * @param timeoutMs per-call deadline.
 * @returns the controller and a disposer that clears the timer/listener.
 */
function abortBudget (signal: AbortSignal | undefined, timeoutMs: number): { controller: AbortController, dispose: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const forward = (): void => controller.abort(signal && signal.reason)

  if (signal) {
    signal.addEventListener('abort', forward, { once: true })

    if (signal.aborted) forward()
  }

  return {
    controller,
    dispose (): void {
      clearTimeout(timer)

      if (signal) signal.removeEventListener('abort', forward)
    },
  }
}

/**
 * Reject with the mapped error for a fetch-level failure.
 *
 * @param error thrown value.
 * @param controller controller used for this call.
 * @param signal caller signal.
 * @returns never.
 */
function rethrowFetchFailure (error: unknown, controller: AbortController, signal: AbortSignal | undefined): never {
  if (error !== null && typeof error === 'object' && (error as GroqError)[MAPPED] === true) throw error

  if (controller.signal.aborted) {
    if (signal && signal.aborted) {
      const aborted = failure('Groq transcription aborted', 'groq-aborted')

      aborted.name = 'AbortError'
      throw aborted
    }

    throw failure('Groq request timed out', 'groq-timeout')
  }

  throw failure('Could not reach Groq', 'groq-network')
}

function audioByteLength (audio: unknown): number {
  if (audio === null || audio === undefined) return 0
  if (typeof (audio as { byteLength?: unknown }).byteLength === 'number') return (audio as { byteLength: number }).byteLength
  if (typeof (audio as { length?: unknown }).length === 'number') return (audio as { length: number }).length

  return 0
}

export interface TranscribeOptions {
  /** 16 kHz mono PCM16 WAV bytes. */
  audio?: unknown
  /** Resolved per call; never logged. */
  apiKey?: string
  /** Whisper model id. */
  model?: string
  /** Language hint; `auto` / empty omits the field. */
  language?: string
  /** API base, defaults to {@link resolveApiBase}. */
  baseUrl?: string
  /** Caller cancellation. */
  signal?: AbortSignal
  /** Injectable fetch for offline tests. */
  fetchImpl?: typeof fetch
  /** Per-call deadline. */
  timeoutMs?: number
}

export interface TranscribeResult {
  text: string
  inferenceSeconds: number
}

/**
 * Transcribe one complete WAV recording through Groq.
 *
 * @param options audio, key, model and request controls.
 * @returns the transcript and inference time.
 */
export async function transcribeWithGroq (options: TranscribeOptions = {}): Promise<TranscribeResult> {
  const {
    audio,
    apiKey,
    model,
    language,
    baseUrl,
    signal,
    fetchImpl = globalThis.fetch,
    timeoutMs = GROQ_TIMEOUT_MS,
  } = options

  if (typeof apiKey !== 'string' || apiKey === '') {
    throw failure('Groq API key is not configured', 'groq-key-missing')
  }

  if (audioByteLength(audio) === 0) {
    throw failure('No audio to transcribe', 'audio-empty')
  }

  if (typeof fetchImpl !== 'function') {
    throw failure('Could not reach Groq', 'groq-network')
  }

  const form = new FormData()

  form.append('file', new Blob([audio as BlobPart], { type: 'audio/wav' }), 'recording.wav')
  form.append('model', String(model ?? ''))

  const hint = normalizeLanguage(language)

  if (hint !== '') form.append('language', hint)

  form.append('response_format', 'json')
  form.append('temperature', '0')

  const url = `${(baseUrl || resolveApiBase()).replace(/\/+$/, '')}/audio/transcriptions`
  const { controller, dispose } = abortBudget(signal, timeoutMs)
  const started = Date.now()

  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}` },
      body: form,
      signal: controller.signal,
    })

    if (!response.ok) {
      throw failure(groqErrorMessage(response.status), groqErrorCode(response.status), response.status)
    }

    let data: unknown = null

    try {
      data = await response.json()
    } catch {
      data = null
    }

    const text = data !== null && typeof data === 'object' && typeof (data as { text?: unknown }).text === 'string'
      ? (data as { text: string }).text
      : ''

    return {
      text,
      inferenceSeconds: Math.max(0, (Date.now() - started) / 1000),
    }
  } catch (error) {
    rethrowFetchFailure(error, controller, signal)
  } finally {
    dispose()
  }
}
