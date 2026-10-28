/**
 * Groq HTTP client for one transcription.
 *
 * Only Node built-ins plus global `fetch`/`FormData`/`Blob` are used. Error
 * messages are fixed strings: a provider response body is never echoed,
 * because a body can contain fragments of the submitted key.
 */

import {
  DEFAULT_API_BASE,
  GROQ_TIMEOUT_MS
} from './constants.js'

/** Marks an error this module already mapped; never leaks into messages. */
const MAPPED = Symbol('groq-mapped-error')

/**
 * Resolve the Groq API base URL, honoring the test/deployment override.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string} base URL without a trailing slash.
 */
export function resolveApiBase (env = process.env) {
  const override = env && typeof env.GROQ_SPEECH_API_BASE === 'string'
    ? env.GROQ_SPEECH_API_BASE.trim()
    : ''
  const base = override !== '' ? override : DEFAULT_API_BASE
  // A malformed override would make every request fail obscurely; fall back to
  // the documented endpoint instead.
  if (!/^https?:\/\/[^\s]+$/i.test(base)) return DEFAULT_API_BASE
  return base.replace(/\/+$/, '')
}

/**
 * Normalize a language hint to Whisper's primary subtag.
 * `auto`, empty, and unrecognized values mean "omit the field".
 * @param {unknown} value
 * @returns {string} a 2–3 letter lowercase code, or `''`.
 */
export function normalizeLanguage (value) {
  if (typeof value !== 'string') return ''
  const primary = value.trim().toLowerCase().split(/[-_]/)[0]
  if (primary === '' || primary === 'auto') return ''
  return /^[a-z]{2,3}$/.test(primary) ? primary : ''
}

/**
 * Approximate duration of a 16 kHz mono PCM16 WAV recording.
 * @param {unknown} byteLength - WAV byte length.
 * @returns {number} seconds, never negative.
 */
export function wavDurationSeconds (byteLength) {
  if (typeof byteLength !== 'number' || !Number.isFinite(byteLength) || byteLength <= 0) return 0
  return byteLength / 32000
}

/**
 * Fixed, non-leaking message for one Groq HTTP status.
 * @param {number} status
 * @returns {string}
 */
export function groqErrorMessage (status) {
  if (status === 401 || status === 403) return 'Groq rejected the API key'
  if (status === 429) return 'Groq rate limit reached'
  if (typeof status === 'number' && status >= 500 && status <= 599) return 'Groq is unavailable'
  return 'Groq request failed'
}

/**
 * Stable machine code paired with {@link groqErrorMessage}.
 * @param {number} status
 * @returns {string}
 */
export function groqErrorCode (status) {
  if (status === 401 || status === 403) return 'groq-auth'
  if (status === 429) return 'groq-rate-limit'
  if (typeof status === 'number' && status >= 500 && status <= 599) return 'groq-unavailable'
  return 'groq-http'
}

/** @param {string} message @param {string} code @param {number} [status] */
function failure (message, code, status) {
  const error = new Error(message)
  error.code = code
  if (typeof status === 'number') error.status = status
  error[MAPPED] = true
  return error
}

/**
 * Wire a caller signal and the per-call timeout to one AbortController.
 * An already-aborted signal never fires a late listener, so its state is
 * forwarded explicitly.
 * @param {AbortSignal | undefined} signal
 * @param {number} timeoutMs
 */
function abortBudget (signal, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const forward = () => controller.abort(signal && signal.reason)

  if (signal) {
    signal.addEventListener('abort', forward, { once: true })
    if (signal.aborted) forward()
  }

  return {
    controller,
    dispose () {
      clearTimeout(timer)
      if (signal) signal.removeEventListener('abort', forward)
    }
  }
}

/**
 * Reject with the mapped error for a fetch-level failure.
 * @param {unknown} error
 * @param {AbortController} controller
 * @param {AbortSignal | undefined} signal
 * @returns {never}
 */
function rethrowFetchFailure (error, controller, signal) {
  if (error !== null && typeof error === 'object' && error[MAPPED] === true) throw error

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

/** @param {unknown} audio */
function audioByteLength (audio) {
  if (audio === null || audio === undefined) return 0
  if (typeof audio.byteLength === 'number') return audio.byteLength
  if (typeof audio.length === 'number') return audio.length
  return 0
}

/**
 * Transcribe one complete WAV recording through Groq.
 * @param {object} options
 * @param {Uint8Array} options.audio - 16 kHz mono PCM16 WAV bytes.
 * @param {string} options.apiKey - resolved per call; never logged.
 * @param {string} options.model - Whisper model id.
 * @param {string} [options.language] - hint; `auto` / empty omits the field.
 * @param {string} [options.baseUrl] - API base, default {@link resolveApiBase}.
 * @param {AbortSignal} [options.signal] - caller cancellation.
 * @param {typeof fetch} [options.fetchImpl] - injectable for tests.
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{text: string, inferenceSeconds: number}>}
 */
export async function transcribeWithGroq ({
  audio,
  apiKey,
  model,
  language,
  baseUrl,
  signal,
  fetchImpl = globalThis.fetch,
  timeoutMs = GROQ_TIMEOUT_MS
} = {}) {
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
  form.append('file', new Blob([audio], { type: 'audio/wav' }), 'recording.wav')
  form.append('model', model)
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
      signal: controller.signal
    })

    if (!response.ok) {
      throw failure(groqErrorMessage(response.status), groqErrorCode(response.status), response.status)
    }

    let data = null
    try {
      data = await response.json()
    } catch {
      data = null
    }

    const text = data !== null && typeof data === 'object' && typeof data.text === 'string'
      ? data.text
      : ''

    return {
      text,
      inferenceSeconds: Math.max(0, (Date.now() - started) / 1000)
    }
  } catch (error) {
    rethrowFetchFailure(error, controller, signal)
  } finally {
    dispose()
  }
}

