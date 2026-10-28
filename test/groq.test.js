/**
 * Groq HTTP client: WAV duration estimate, error mapping, multipart shape and
 * success parsing. All requests go to a loopback server via
 * `GROQ_SPEECH_API_BASE`; no real Groq endpoint is contacted.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { DEFAULT_API_BASE } from '../lib/constants.js'
import {
  groqErrorCode,
  groqErrorMessage,
  normalizeLanguage,
  resolveApiBase,
  transcribeWithGroq,
  wavDurationSeconds
} from '../lib/groq.js'
import { withEnv } from './helpers/env.js'
import { parseMultipart, sendJson, startGroqServer, wavBytes } from './helpers/groq-server.js'

/** A distinctive value that must never appear in a surfaced error. */
const SECRET = 'gsk_test_do_not_leak_1234567890'

const fieldsByName = (fields) => Object.fromEntries(fields.map((field) => [field.name, field]))

/**
 * Run `fn` against a fake provider that answers every request with a fixed
 * status and body, then collect the surfaced error.
 * @param {number} status
 * @param {unknown} body
 * @param {(error: Error & {code?: string, status?: number}) => void} check
 */
async function expectGroqFailure (status, body, check) {
  const server = await startGroqServer((record, res) => sendJson(res, status, body))
  try {
    await withEnv({ GROQ_SPEECH_API_BASE: server.baseUrl }, async () => {
      const error = await transcribeWithGroq({
        audio: wavBytes(0.1),
        apiKey: SECRET,
        model: 'whisper-large-v3-turbo',
        language: 'ru'
      }).then(
        () => null,
        (reason) => reason
      )
      assert.ok(error instanceof Error, `status ${status} should reject`)
      check(error)
    })
  } finally {
    await server.close()
  }
}

test('wavDurationSeconds estimates 16 kHz mono PCM16 and clamps invalid input', () => {
  assert.equal(wavDurationSeconds(32000), 1)
  assert.equal(wavDurationSeconds(16000), 0.5)
  assert.equal(wavDurationSeconds(48000), 1.5)
  assert.equal(wavDurationSeconds(0), 0)
  assert.equal(wavDurationSeconds(-100), 0)
  assert.equal(wavDurationSeconds(Number.NaN), 0)
  assert.equal(wavDurationSeconds(Number.POSITIVE_INFINITY), 0)
  assert.equal(wavDurationSeconds('32000'), 0)
  assert.equal(wavDurationSeconds(undefined), 0)
})

test('normalizeLanguage keeps a primary subtag and drops auto/unknown values', () => {
  assert.equal(normalizeLanguage('ru'), 'ru')
  assert.equal(normalizeLanguage('EN'), 'en')
  assert.equal(normalizeLanguage('en-US'), 'en')
  assert.equal(normalizeLanguage('zh_Hans'), 'zh')
  assert.equal(normalizeLanguage(' yue '), 'yue')
  assert.equal(normalizeLanguage('auto'), '')
  assert.equal(normalizeLanguage(''), '')
  assert.equal(normalizeLanguage('   '), '')
  assert.equal(normalizeLanguage('english'), '')
  assert.equal(normalizeLanguage(42), '')
  assert.equal(normalizeLanguage(undefined), '')
})

test('resolveApiBase uses the default base and validates the override', () => {
  assert.equal(resolveApiBase({}), DEFAULT_API_BASE)
  assert.equal(resolveApiBase({ GROQ_SPEECH_API_BASE: '   ' }), DEFAULT_API_BASE)
  assert.equal(
    resolveApiBase({ GROQ_SPEECH_API_BASE: ' http://127.0.0.1:9999/v1/ ' }),
    'http://127.0.0.1:9999/v1'
  )
  assert.equal(resolveApiBase({ GROQ_SPEECH_API_BASE: 'https://example.test/api' }), 'https://example.test/api')
  assert.equal(resolveApiBase({ GROQ_SPEECH_API_BASE: 'ftp://example.test' }), DEFAULT_API_BASE)
  assert.equal(resolveApiBase({ GROQ_SPEECH_API_BASE: 'not a url' }), DEFAULT_API_BASE)
})

test('Groq status mapping is fixed and covers auth, rate limit and outages', () => {
  const table = [
    [401, 'groq-auth', 'Groq rejected the API key'],
    [403, 'groq-auth', 'Groq rejected the API key'],
    [429, 'groq-rate-limit', 'Groq rate limit reached'],
    [500, 'groq-unavailable', 'Groq is unavailable'],
    [503, 'groq-unavailable', 'Groq is unavailable'],
    [599, 'groq-unavailable', 'Groq is unavailable'],
    [400, 'groq-http', 'Groq request failed'],
    [418, 'groq-http', 'Groq request failed'],
    [undefined, 'groq-http', 'Groq request failed']
  ]
  for (const [status, code, message] of table) {
    assert.equal(groqErrorCode(status), code)
    assert.equal(groqErrorMessage(status), message)
  }
})

test('transcribeWithGroq posts a multipart WAV with model, language and json format', async () => {
  const server = await startGroqServer((record, res) => sendJson(res, 200, { text: 'привет мир' }))
  try {
    await withEnv({ GROQ_SPEECH_API_BASE: server.baseUrl }, async () => {
      const audio = wavBytes(2)
      const result = await transcribeWithGroq({
        audio,
        apiKey: SECRET,
        model: 'whisper-large-v3',
        language: 'ru'
      })

      assert.equal(result.text, 'привет мир')
      assert.equal(typeof result.inferenceSeconds, 'number')
      assert.ok(result.inferenceSeconds >= 0)
      assert.equal(server.requests.length, 1)

      const request = server.requests[0]
      assert.equal(request.method, 'POST')
      assert.equal(request.url, '/v1/audio/transcriptions')
      assert.equal(request.headers.authorization, `Bearer ${SECRET}`)

      const parsed = parseMultipart(request)
      assert.match(parsed.contentType, /^multipart\/form-data; boundary=/)
      const fields = fieldsByName(parsed.fields)
      assert.deepEqual(Object.keys(fields).sort(), ['file', 'language', 'model', 'response_format', 'temperature'])

      assert.equal(fields.file.filename, 'recording.wav')
      assert.equal(fields.file.contentType, 'audio/wav')
      assert.equal(fields.file.bytes.length, audio.length)
      assert.deepEqual(fields.file.bytes, audio)

      assert.equal(fields.model.value, 'whisper-large-v3')
      assert.equal(fields.language.value, 'ru')
      assert.equal(fields.response_format.value, 'json')
      assert.equal(fields.temperature.value, '0')
    })
  } finally {
    await server.close()
  }
})

test('transcribeWithGroq omits the language field for auto/empty hints', async () => {
  const server = await startGroqServer((record, res) => sendJson(res, 200, { text: '' }))
  try {
    await withEnv({ GROQ_SPEECH_API_BASE: server.baseUrl }, async () => {
      const result = await transcribeWithGroq({
        audio: wavBytes(0.5),
        apiKey: SECRET,
        model: 'whisper-large-v3-turbo',
        language: 'auto'
      })
      assert.equal(result.text, '', 'empty transcript is valid')

      const fields = fieldsByName(parseMultipart(server.requests[0]).fields)
      assert.equal('language' in fields, false)
      assert.equal(fields.model.value, 'whisper-large-v3-turbo')
    })
  } finally {
    await server.close()
  }
})

test('transcribeWithGroq rejects 401/403 without echoing the key or response body', async () => {
  for (const status of [401, 403]) {
    await expectGroqFailure(status, { error: { message: `Invalid key ${SECRET}` } }, (error) => {
      assert.equal(error.message, 'Groq rejected the API key')
      assert.equal(error.code, 'groq-auth')
      assert.equal(error.status, status)
      const surfaces = [error.message, String(error.stack), JSON.stringify(error)]
      for (const surface of surfaces) assert.equal(surface.includes(SECRET), false)
    })
  }
})

test('transcribeWithGroq maps 429 to a rate-limit error without leaking the key', async () => {
  await expectGroqFailure(429, { error: { message: `slow down ${SECRET}` } }, (error) => {
    assert.equal(error.message, 'Groq rate limit reached')
    assert.equal(error.code, 'groq-rate-limit')
    assert.equal(error.status, 429)
    assert.equal(String(error.stack).includes(SECRET), false)
  })
})

test('transcribeWithGroq maps 5xx to an availability error', async () => {
  for (const status of [500, 502, 503]) {
    await expectGroqFailure(status, { error: `upstream ${SECRET}` }, (error) => {
      assert.equal(error.message, 'Groq is unavailable')
      assert.equal(error.code, 'groq-unavailable')
      assert.equal(error.status, status)
      assert.equal(String(error.stack).includes(SECRET), false)
    })
  }
})

test('transcribeWithGroq maps a dropped connection to a network error', async () => {
  const server = await startGroqServer((record, res) => {
    res.destroy()
  })
  try {
    await withEnv({ GROQ_SPEECH_API_BASE: server.baseUrl }, async () => {
      const error = await transcribeWithGroq({
        audio: wavBytes(0.1),
        apiKey: SECRET,
        model: 'whisper-large-v3-turbo'
      }).then(
        () => null,
        (reason) => reason
      )
      assert.ok(error instanceof Error)
      assert.equal(error.message, 'Could not reach Groq')
      assert.equal(error.code, 'groq-network')
      assert.equal(String(error.stack).includes(SECRET), false)
    })
  } finally {
    await server.close()
  }
})

test('transcribeWithGroq forwards an aborted caller signal', async () => {
  const server = await startGroqServer((record, res) => sendJson(res, 200, { text: 'late' }))
  try {
    await withEnv({ GROQ_SPEECH_API_BASE: server.baseUrl }, async () => {
      const controller = new AbortController()
      controller.abort()
      const error = await transcribeWithGroq({
        audio: wavBytes(0.1),
        apiKey: SECRET,
        model: 'whisper-large-v3-turbo',
        signal: controller.signal
      }).then(
        () => null,
        (reason) => reason
      )
      assert.ok(error instanceof Error)
      assert.equal(error.name, 'AbortError')
      assert.equal(error.code, 'groq-aborted')
      assert.equal(error.message, 'Groq transcription aborted')
      assert.equal(String(error.stack).includes(SECRET), false)
    })
  } finally {
    await server.close()
  }
})

test('transcribeWithGroq rejects a missing key and empty audio before any request', async () => {
  const missing = await transcribeWithGroq({
    audio: wavBytes(1),
    apiKey: '',
    model: 'whisper-large-v3-turbo'
  }).then(() => null, (reason) => reason)
  assert.equal(missing.message, 'Groq API key is not configured')
  assert.equal(missing.code, 'groq-key-missing')

  const empty = await transcribeWithGroq({
    audio: new Uint8Array(0),
    apiKey: SECRET,
    model: 'whisper-large-v3-turbo'
  }).then(() => null, (reason) => reason)
  assert.equal(empty.message, 'No audio to transcribe')
  assert.equal(empty.code, 'audio-empty')
})

