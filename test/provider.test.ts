/**
 * @jest-environment node
 */

/**
 * SpeechProvider behaviour: metadata, key resolution, transcription through
 * the fake Groq server, and polish fallback at the provider boundary.
 */

import assert from 'node:assert/strict'

import { LANGUAGES } from '../src/constants'
import type { GroqSpeechSettings } from '../src/contracts'
import {
  credentialSource,
  createProvider,
  describeGroqKey,
  resolveGroqKey,
  resolveLanguage,
} from '../src/provider'
import { withTempHome } from './helpers/env'
import { createFakeCtx } from './helpers/fake-ctx'
import { parseMultipart, sendJson, startGroqServer, wavBytes } from './helpers/groq-server'

const SECRET = 'gsk_provider_secret_0123456789'

const SETTINGS = (overrides: Partial<GroqSpeechSettings> = {}): GroqSpeechSettings => ({
  model: 'whisper-large-v3-turbo',
  language: 'auto',
  polish: { provider: '', model: '', prompt: '' },
  ...overrides,
})

test('provider info advertises groq-whisper in the cloud with no preparation', () => {
  const provider = createProvider(createFakeCtx().ctx, { env: {}, read: () => SETTINGS() })

  assert.deepEqual(Object.keys(provider.info).sort(), ['id', 'languages', 'location', 'name'])
  assert.equal(provider.info.id, 'groq-whisper')
  assert.equal(provider.info.name, 'Groq Whisper')
  assert.equal(provider.info.location, 'cloud')
  assert.deepEqual(provider.info.languages, LANGUAGES)
  assert.equal('preparation' in provider.info, false)
  assert.equal(typeof provider.transcribe, 'function')
})

test('resolveLanguage prefers the explicit input over the stored setting', () => {
  assert.equal(resolveLanguage('en', 'ru'), 'en')
  assert.equal(resolveLanguage('en-US', 'ru'), 'en')
  assert.equal(resolveLanguage('auto', 'ru'), 'ru')
  assert.equal(resolveLanguage('', 'de'), 'de')
  assert.equal(resolveLanguage(undefined, 'auto'), '')
  assert.equal(resolveLanguage('nonsense', 'pl'), 'pl')
})

test('credentialSource maps provider layers onto the UI vocabulary', () => {
  assert.equal(credentialSource('env'), 'env')
  assert.equal(credentialSource('file-env'), 'env')
  assert.equal(credentialSource('file'), 'stored')
  assert.equal(credentialSource('keychain'), 'stored')
  assert.equal(credentialSource(''), null)
  assert.equal(credentialSource(undefined), null)
  assert.equal(credentialSource(42), null)
})

test('resolveGroqKey reads credentials first and trims the value', async () => {
  const stored = createFakeCtx({ key: `  ${SECRET}  ` })

  assert.equal(await resolveGroqKey(stored.ctx, { GROQ_API_KEY: 'gsk_env' }), SECRET)
  assert.equal(stored.calls.resolve.length, 1)

  const empty = createFakeCtx()

  assert.equal(await resolveGroqKey(empty.ctx, { GROQ_API_KEY: 'gsk_env' }), '')

  assert.equal(await resolveGroqKey({}, { GROQ_API_KEY: '  gsk_env  ' }), 'gsk_env')
  assert.equal(await resolveGroqKey({}, {}), '')
})

test('describeGroqKey never exposes more than presence, source and writability', async () => {
  const stored = createFakeCtx({ key: SECRET })

  assert.deepEqual(await describeGroqKey(stored.ctx), {
    configured: true,
    source: 'stored',
    writable: true,
  })

  const fromEnv = createFakeCtx({ envKey: 'gsk_env_key_12345678' })
  const described = await describeGroqKey(fromEnv.ctx)

  assert.deepEqual(described, { configured: true, source: 'env', writable: false })
  assert.equal(JSON.stringify(described).includes('gsk_env_key_12345678'), false)

  assert.deepEqual(await describeGroqKey({}, {}), {
    configured: false,
    source: null,
    writable: false,
  })
  assert.deepEqual(await describeGroqKey({}, { GROQ_API_KEY: 'gsk_env' }), {
    configured: true,
    source: 'env',
    writable: false,
  })
})

test('transcribe fails with a fixed message when no Groq key is configured', async () => {
  const provider = createProvider(createFakeCtx().ctx, { env: {}, read: () => SETTINGS() })
  const error = await provider
    .transcribe({ audio: wavBytes(1), language: 'auto' })
    .then(() => null, (reason: unknown) => reason as Error & { code?: string })

  assert.ok(error instanceof Error)
  assert.equal(error.message, 'Groq API key is not configured')
  assert.equal(error.code, 'groq-key-missing')
  assert.equal(error.message.includes('gsk_'), false)
})

test('transcribe uploads audio, measures duration and resolves the key per call', async () => {
  const server = await startGroqServer((record, res) => sendJson(res, 200, { text: 'hello world' }))

  try {
    await withTempHome(async () => {
      const fake = createFakeCtx({ key: SECRET })
      const provider = createProvider(fake.ctx, {
        env: { GROQ_SPEECH_API_BASE: server.baseUrl },
        read: () => SETTINGS({ model: 'whisper-large-v3', language: 'ru' }),
      })

      const audio = wavBytes(2)
      const result = await provider.transcribe({ audio, language: 'en' })

      assert.equal(result.text, 'hello world')
      assert.equal(result.audioSeconds, 2)
      assert.equal(typeof result.inferenceSeconds, 'number')
      assert.ok(result.inferenceSeconds >= 0)

      const fields = Object.fromEntries(parseMultipart(server.requests[0]).fields.map((f) => [f.name, f.value]))

      assert.equal(fields.model, 'whisper-large-v3')
      assert.equal(fields.language, 'en')

      await provider.transcribe({ audio, language: 'auto' })
      assert.equal(fake.calls.resolve.length, 2, 'the key is resolved for every transcription')
    })
  } finally {
    await server.close()
  }
})

test('transcribe falls back to the stored language hint', async () => {
  const server = await startGroqServer((record, res) => sendJson(res, 200, { text: 'hallo' }))

  try {
    await withTempHome(async () => {
      const provider = createProvider(createFakeCtx({ key: SECRET }).ctx, {
        env: { GROQ_SPEECH_API_BASE: server.baseUrl },
        read: () => SETTINGS({ language: 'de' }),
      })

      await provider.transcribe({ audio: wavBytes(0.25), language: 'auto' })

      const fields = Object.fromEntries(parseMultipart(server.requests[0]).fields.map((f) => [f.name, f.value]))

      assert.equal(fields.language, 'de')
    })
  } finally {
    await server.close()
  }
})

test('transcribe routes polish through the agent Groq provider, not the Groq key', async () => {
  const server = await startGroqServer((record, res) => sendJson(res, 200, { text: 'привет мир' }))

  try {
    await withTempHome(async () => {
      const fake = createFakeCtx({ key: SECRET })
      let prepared: unknown = null

      fake.ctx.llm = {
        async prepareCall (route: unknown) {
          prepared = route
          throw new Error('route reached')
        },
      }

      const provider = createProvider(fake.ctx, {
        env: { GROQ_SPEECH_API_BASE: server.baseUrl },
        read: () => SETTINGS({
          polish: { provider: 'groq', model: 'openai/gpt-oss-120b', prompt: 'Fix it.' },
        }),
      })

      const result = await provider.transcribe({ audio: wavBytes(1), language: 'ru' })

      assert.equal(result.text, 'привет мир')
      assert.deepEqual(prepared, { provider: 'groq', model: 'openai/gpt-oss-120b' })
      assert.deepEqual(server.requests.map((request) => request.url), ['/v1/audio/transcriptions'])
    })
  } finally {
    await server.close()
  }
})

test('transcribe returns the raw transcript when the polish stream fails', async () => {
  const server = await startGroqServer((record, res) => sendJson(res, 200, { text: 'сырой текст' }))

  try {
    await withTempHome(async () => {
      const fake = createFakeCtx({ key: SECRET })

      fake.ctx.llm = {
        async prepareCall () {
          return {
            config: {},
            async * stream () {
              yield { type: 'text-delta', text: 'испорченный' }
              throw new Error('LLM went away')
            },
          }
        },
      }

      const provider = createProvider(fake.ctx, {
        env: { GROQ_SPEECH_API_BASE: server.baseUrl },
        read: () => SETTINGS({
          polish: { provider: 'alpha', model: 'alpha-large', prompt: '' },
        }),
      })

      const result = await provider.transcribe({ audio: wavBytes(1), language: 'ru' })

      assert.equal(result.text, 'сырой текст')
    })
  } finally {
    await server.close()
  }
})

test('transcribe skips polish entirely when no model is configured', async () => {
  const server = await startGroqServer((record, res) => sendJson(res, 200, { text: 'plain' }))

  try {
    await withTempHome(async () => {
      let polishCalls = 0
      const fake = createFakeCtx({ key: SECRET })

      fake.ctx.llm = {
        async prepareCall () {
          polishCalls += 1
          throw new Error('must not be called')
        },
      }

      for (const polish of [
        { provider: 'alpha', model: '', prompt: '' },
        { provider: '', model: 'm', prompt: '' },
        { provider: '', model: '', prompt: '' },
      ]) {
        const provider = createProvider(fake.ctx, {
          env: { GROQ_SPEECH_API_BASE: server.baseUrl },
          read: () => SETTINGS({ polish }),
        })
        const result = await provider.transcribe({ audio: wavBytes(1) })

        assert.equal(result.text, 'plain')
      }

      assert.equal(polishCalls, 0)
    })
  } finally {
    await server.close()
  }
})
