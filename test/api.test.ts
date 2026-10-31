/**
 * @jest-environment node
 */

/**
 * Browser JSON API: every documented action against hand-written fake host
 * contexts. No response may ever contain stored key material.
 */

import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'

import { createApiHandler, dispatchAction } from '../src/api'
import { DEFAULT_SETTINGS } from '../src/constants'
import { readSettings, writeSettings } from '../src/settings'
import { withTempHome } from './helpers/env'
import { createFakeCtx } from './helpers/fake-ctx'

/** Stored credential material that must never leave the host. */
const SECRET = 'gsk_stored_secret_abcdefghijklmnop'

interface ApiResponse {
  status: number
  body: any
}

/**
 * Run one action and expose the response body as a test-friendly value.
 *
 * @param ctx fake host context.
 * @param payload request body.
 * @returns status and parsed envelope.
 */
async function act (ctx: unknown, payload: unknown): Promise<ApiResponse> {
  return await dispatchAction(ctx, payload) as ApiResponse
}

/**
 * Assert that one action fails with the documented status and code.
 *
 * @param promise action promise.
 * @param status expected HTTP status.
 * @param code expected stable error code.
 */
async function expectApiFailure (
  promise: Promise<ApiResponse>,
  status: number,
  code: string,
): Promise<void> {
  const error = await promise.then(() => null, (reason: unknown) => reason)

  assert.ok(error instanceof Error, 'action should fail')
  assert.equal(error.name, 'ApiFailure')
  assert.equal((error as Error & { status?: number }).status, status)
  assert.equal((error as Error & { code?: string }).code, code)
}

/**
 * Start a loopback server that mounts the real prefix handler.
 *
 * @param ctx fake host context.
 * @param options trusted hosts.
 * @returns the origin and a close function.
 */
async function startApiServer (
  ctx: unknown,
  options: { trustedHosts?: string[] } = {},
): Promise<{ origin: string, close: () => Promise<void> }> {
  const handler = createApiHandler(ctx, options)
  const server = createServer((req, res) => {
    handler(req, res).catch(() => {
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end('{"ok":false}')
      } else {
        res.destroy()
      }
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })

  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0

  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

/** Minimal response double for synthetic handler calls. */
class StubResponse {
  statusCode = 0
  headers: Record<string, unknown> = {}
  body = ''
  writableEnded = false
  destroyed = false

  writeHead (status: number, headers: Record<string, unknown>): this {
    this.statusCode = status
    this.headers = headers

    return this
  }

  setHeader (name: string, value: unknown): void {
    this.headers[name] = value
  }

  end (chunk?: string): void {
    this.body = chunk === undefined ? '' : chunk
    this.writableEnded = true
  }
}

interface CallOptions {
  host?: string
  trustedHosts?: string[]
  ctx?: unknown
  body?: Record<string, unknown>
}

/**
 * Invoke the API handler with a synthetic request.
 *
 * @param options host authority, trusted hosts, context and JSON body.
 * @returns captured status code and parsed response body.
 */
async function callApi (options: CallOptions = {}): Promise<{ statusCode: number, payload: any }> {
  const host = options.host ?? '127.0.0.1:3080'
  const handler = createApiHandler(options.ctx ?? {}, { trustedHosts: options.trustedHosts ?? [] })
  const req = Readable.from([JSON.stringify(options.body ?? { action: 'unknown' })]) as unknown as IncomingMessage

  req.method = 'POST'
  req.headers = { host, origin: `http://${host}`, 'content-type': 'application/json' }

  const res = new StubResponse()

  await handler(req, res as unknown as ServerResponse)

  return { statusCode: res.statusCode, payload: JSON.parse(res.body) }
}

test('status reports defaults and never contains a key', async () => {
  await withTempHome(async () => {
    const { ctx } = createFakeCtx()
    const { status, body } = await act(ctx, { action: 'status' })

    assert.equal(status, 200)
    assert.equal(body.ok, true)
    assert.deepEqual(body.value, {
      configured: false,
      source: null,
      writable: true,
      envVar: 'GROQ_API_KEY',
      settings: DEFAULT_SETTINGS,
      voice: {
        available: true,
        selectable: true,
        providerId: 'sensevoice-local',
        providerName: 'SenseVoiceSmall',
        selected: false,
      },
    })
    assert.equal('key' in body.value, false)
  })
})

test('status reports Groq Whisper when the official voice input selects it', async () => {
  await withTempHome(async () => {
    const { ctx } = createFakeCtx({ selectedProvider: 'groq-whisper' })
    const { body } = await act(ctx, { action: 'status' })

    assert.deepEqual(body.value.voice, {
      available: true,
      selectable: true,
      providerId: 'groq-whisper',
      providerName: 'Groq Whisper',
      selected: true,
    })
  })
})

test('status reports voice input as unavailable when the speech service is missing', async () => {
  await withTempHome(async () => {
    const { ctx } = createFakeCtx({ speech: null })
    const { status, body } = await act(ctx, { action: 'status' })

    assert.equal(status, 200)
    assert.deepEqual(body.value.voice, {
      available: false,
      selectable: false,
      providerId: null,
      providerName: null,
      selected: false,
    })
  })
})

test('status reports voice input as unavailable when the snapshot throws', async () => {
  await withTempHome(async () => {
    const { ctx } = createFakeCtx({
      speech: {
        snapshot () {
          throw new Error('speech service is booting')
        },
      },
    })
    const { body } = await act(ctx, { action: 'status' })

    assert.equal(body.value.voice.available, false)
    assert.equal(body.value.voice.selectable, false)
  })
})

test('select-provider switches the voice input to Groq Whisper', async () => {
  await withTempHome(async () => {
    const fake = createFakeCtx({ key: SECRET })
    const { status, body } = await act(fake.ctx, { action: 'select-provider' })

    assert.equal(status, 200)
    assert.deepEqual(fake.calls.selections, ['groq-whisper'])
    assert.deepEqual(body.value.voice, {
      available: true,
      selectable: true,
      providerId: 'groq-whisper',
      providerName: 'Groq Whisper',
      selected: true,
    })
    assert.equal(JSON.stringify(body).includes(SECRET), false)

    const statusAfter = await act(fake.ctx, { action: 'status' })

    assert.equal(statusAfter.body.value.voice.selected, true)
  })
})

test('select-provider refuses when the official service cannot switch providers', async () => {
  await withTempHome(async () => {
    const fake = createFakeCtx({ speech: {} })

    await expectApiFailure(
      act(fake.ctx, { action: 'select-provider' }),
      409,
      'voice-unavailable',
    )

    assert.deepEqual(fake.calls.selections, [])
  })
})

test('select-provider reports a fixed failure when the official configure throws', async () => {
  await withTempHome(async () => {
    const fake = createFakeCtx({
      speech: {
        snapshot () {
          return {
            providers: [
              { id: 'sensevoice-local', name: 'SenseVoiceSmall' },
              { id: 'groq-whisper', name: 'Groq Whisper' },
            ],
            selection: { providerId: 'sensevoice-local', language: 'auto' },
          }
        },
        async configure () {
          throw new Error('Speech selection requires the settings service and a profile entry')
        },
      },
    })

    const error = await act(fake.ctx, { action: 'select-provider' })
      .then(() => null, (reason: unknown) => reason as Error & { status?: number, code?: string, message?: string })

    assert.ok(error instanceof Error)
    assert.equal(error.status, 500)
    assert.equal(error.code, 'voice-select-failed')
    assert.equal(error.message?.includes('settings service'), false)
  })
})

test('status with a stored key says configured but exposes no key material', async () => {
  await withTempHome(async () => {
    const { ctx, calls } = createFakeCtx({ key: SECRET })
    const { status, body } = await act(ctx, { action: 'status' })

    assert.equal(status, 200)
    assert.equal(body.value.configured, true)
    assert.equal(body.value.source, 'stored')
    assert.equal(body.value.writable, true)
    assert.equal('key' in body.value, false)
    assert.equal(calls.describe.length, 1)
    assert.equal(JSON.stringify(body).includes(SECRET), false)
    assert.equal(JSON.stringify(body).includes('gsk_'), false)
  })
})

test('status can report an environment-sourced key as read-only', async () => {
  await withTempHome(async () => {
    const { ctx } = createFakeCtx({ envKey: 'gsk_env_sourced_12345678' })
    const { body } = await act(ctx, { action: 'status' })

    assert.equal(body.value.configured, true)
    assert.equal(body.value.source, 'env')
    assert.equal(body.value.writable, false)
  })
})

test('key mutation actions are gone: the key is managed only in Models', async () => {
  await withTempHome(async () => {
    const { ctx, calls } = createFakeCtx({ key: SECRET })

    for (const action of ['set-key', 'clear-key', 'test-key']) {
      await expectApiFailure(
        dispatchAction(ctx, { action, key: SECRET }),
        404,
        'unknown-action',
      )
    }

    assert.equal(calls.set.length, 0)
    assert.equal(calls.unset.length, 0)
  })
})

test('get-settings returns the persisted document', async () => {
  await withTempHome(async () => {
    const { ctx } = createFakeCtx()

    writeSettings({
      model: 'whisper-large-v3',
      language: 'de',
      polish: { provider: 'p', model: 'm', prompt: 'Fix.' },
    })

    const { status, body } = await act(ctx, { action: 'get-settings' })

    assert.equal(status, 200)
    assert.deepEqual(body.value.settings, {
      model: 'whisper-large-v3',
      language: 'de',
      polish: { provider: 'p', model: 'm', prompt: 'Fix.' },
    })
  })
})

test('set-settings validates, persists and returns the stored document', async () => {
  await withTempHome(async () => {
    const { ctx } = createFakeCtx()
    const { status, body } = await act(ctx, {
      action: 'set-settings',
      patch: {
        model: 'whisper-large-v3',
        language: 'ru',
        polish: { provider: 'openai', model: 'gpt-4o-mini', prompt: 'Polish.' },
      },
    })

    assert.equal(status, 200)
    assert.deepEqual(body.value.settings, {
      model: 'whisper-large-v3',
      language: 'ru',
      polish: { provider: 'openai', model: 'gpt-4o-mini', prompt: 'Polish.' },
    })
    assert.deepEqual(readSettings(), body.value.settings)
  })
})

test('set-settings rejects a non-object patch and normalizes invalid fields', async () => {
  await withTempHome(async () => {
    const { ctx } = createFakeCtx()

    for (const patch of [null, 'nope', [], 5]) {
      await expectApiFailure(
        dispatchAction(ctx, { action: 'set-settings', patch }),
        400,
        'bad-request',
      )
    }

    const { body } = await act(ctx, {
      action: 'set-settings',
      patch: { model: 'gpt-4', language: 'EN-us', polish: { provider: 'x', model: 'y' } },
    })

    assert.equal(body.value.settings.model, DEFAULT_SETTINGS.model)
    assert.equal(body.value.settings.language, 'auto')
    assert.equal(body.value.settings.polish.provider, 'x')
    assert.equal(body.value.settings.polish.model, 'y')
  })
})

test('list-models flattens LLM routes and skips failing providers', async () => {
  await withTempHome(async () => {
    const ctx = createFakeCtx({
      llm: {
        listProviders: () => [
          { id: 'alpha', name: 'Alpha Provider' },
          { id: 'broken', name: 'Broken Provider' },
          { id: 'bare' },
          { name: 'no id' },
        ],
        async listModels (provider: string) {
          if (provider === 'broken') throw new Error('adapter exploded')
          if (provider === 'alpha') {
            return [
              { id: 'alpha-large', name: 'Alpha Large' },
              { id: 'alpha-small' },
            ]
          }

          return [{ id: 'bare-model', name: 'Bare Model' }]
        },
      },
    }).ctx

    const { status, body } = await act(ctx, { action: 'list-models' })

    assert.equal(status, 200)
    assert.deepEqual(body.value, [
      { provider: 'alpha', providerName: 'Alpha Provider', model: 'alpha-large', modelName: 'Alpha Large' },
      { provider: 'alpha', providerName: 'Alpha Provider', model: 'alpha-small', modelName: 'alpha-small' },
      { provider: 'bare', providerName: 'bare', model: 'bare-model', modelName: 'Bare Model' },
    ])
  })
})

test('list-models returns an empty list when the LLM service is unusable', async () => {
  await withTempHome(async () => {
    const { ctx } = createFakeCtx({ llm: { listProviders: () => { throw new Error('no llm') } } })
    const { body } = await act(ctx, { action: 'list-models' })

    assert.deepEqual(body.value, [])
  })
})

test('list-models uses the agent Groq route without the Groq key', async () => {
  await withTempHome(async () => {
    const fake = createFakeCtx({
      key: SECRET,
      llm: {
        listProviders: () => [{ id: 'groq', name: 'groq' }],
        async listModels (provider: string) {
          assert.equal(provider, 'groq')

          return [
            { id: 'openai/gpt-oss-120b', name: 'GPT OSS 120B' },
            { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B' },
          ]
        },
      },
    })

    const { status, body } = await act(fake.ctx, { action: 'list-models' })

    assert.equal(status, 200)
    assert.deepEqual(body.value, [
      { provider: 'groq', providerName: 'groq', model: 'openai/gpt-oss-120b', modelName: 'GPT OSS 120B' },
      { provider: 'groq', providerName: 'groq', model: 'llama-3.1-8b-instant', modelName: 'Llama 3.1 8B' },
    ])
    assert.equal(fake.calls.resolve.length, 0, 'the settings picker never touches the Groq key')
    assert.equal(JSON.stringify(body).includes(SECRET), false)
  })
})

test('unknown actions are rejected with 404 unknown-action', async () => {
  await withTempHome(async () => {
    const { ctx } = createFakeCtx()

    await expectApiFailure(
      dispatchAction(ctx, { action: 'delete-everything' }),
      404,
      'unknown-action',
    )
  })
})

test('the HTTP handler fences cross-site, wrong method, wrong type and large bodies', async () => {
  await withTempHome(async () => {
    const { ctx } = createFakeCtx()
    const api = await startApiServer(ctx, { trustedHosts: [] })
    const url = `${api.origin}/groq-speech/api`
    const jsonHeaders = { 'content-type': 'application/json' }

    try {
      const crossSite = await fetch(url, {
        method: 'POST',
        headers: { ...jsonHeaders, 'sec-fetch-site': 'cross-site' },
        body: '{"action":"status"}',
      })

      assert.equal(crossSite.status, 403)
      assert.equal(
        JSON.stringify(await crossSite.json()),
        JSON.stringify({ ok: false, error: { code: 'forbidden', message: 'Forbidden' } }),
      )

      const wrongMethod = await fetch(url, { method: 'GET' })

      assert.equal(wrongMethod.status, 405)

      const wrongType = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: '{"action":"status"}',
      })

      assert.equal(wrongType.status, 415)

      const unknown = await fetch(url, {
        method: 'POST',
        headers: jsonHeaders,
        body: '{"action":"nope"}',
      })

      assert.equal(unknown.status, 404)
      assert.equal((await unknown.json()).error.code, 'unknown-action')

      const big = await fetch(url, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ action: 'status', padding: 'x'.repeat(70 * 1024) }),
      })

      assert.equal(big.status, 413)

      const ok = await fetch(url, {
        method: 'POST',
        headers: { ...jsonHeaders, origin: api.origin },
        body: '{"action":"status"}',
      })

      assert.equal(ok.status, 200)

      const payload = await ok.json()

      assert.equal(payload.ok, true)
      assert.equal(payload.value.configured, false)
    } finally {
      await api.close()
    }
  })
})

test('a remote authority is rejected without a DSH session verifier', async () => {
  await withTempHome(async () => {
    const response = await callApi({
      host: '192.168.1.10:3080',
      trustedHosts: ['192.168.1.10:3080'],
      ctx: createFakeCtx().ctx,
      body: { action: 'status' },
    })

    assert.equal(response.statusCode, 403)
    assert.equal(response.payload.ok, false)
    assert.equal(response.payload.error.code, 'forbidden')
  })
})

test('the DSH connection service gates every loopback request too', async () => {
  await withTempHome(async () => {
    const ctx = {
      ...createFakeCtx().ctx,
      connection: {
        requestRejection: () => 401,
      },
    }

    const response = await callApi({ ctx, body: { action: 'status' } })

    assert.equal(response.statusCode, 401)
    assert.equal(response.payload.error.code, 'authentication-required')
  })
})

test('an admitted connection request reaches the action', async () => {
  await withTempHome(async () => {
    const ctx = {
      ...createFakeCtx().ctx,
      connection: {
        requestRejection: () => undefined,
      },
    }

    const response = await callApi({ ctx, body: { action: 'status' } })

    assert.equal(response.statusCode, 200)
    assert.equal(response.payload.ok, true)
  })
})
