/**
 * Browser JSON API: every documented action against hand-written fake host
 * contexts. No response may ever contain stored key material.
 */

import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'

import { createApiHandler, dispatchAction } from '../lib/api.js'
import { DEFAULT_SETTINGS } from '../lib/constants.js'
import { readSettings, writeSettings } from '../lib/settings.js'
import { withTempHome } from './helpers/env.js'
import { createFakeCtx } from './helpers/fake-ctx.js'

/** Stored credential material that must never leave the host. */
const SECRET = 'gsk_stored_secret_abcdefghijklmnop'

/** @param {Promise<{status: number, body: any}>} promise */
async function expectApiFailure (promise, status, code) {
  const error = await promise.then(() => null, (reason) => reason)
  assert.ok(error instanceof Error, 'action should fail')
  assert.equal(error.name, 'ApiFailure')
  assert.equal(error.status, status)
  assert.equal(error.code, code)
  return error
}

/** Start a loopback server that mounts the real prefix handler. */
async function startApiServer (ctx, options = {}) {
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
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const { port } = server.address()
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve))
  }
}

test('status reports defaults and never contains a key', async () => {
  await withTempHome(async () => {
    const { ctx } = createFakeCtx()
    const { status, body } = await dispatchAction(ctx, { action: 'status' })
    assert.equal(status, 200)
    assert.equal(body.ok, true)
    assert.deepEqual(body.value, {
      configured: false,
      source: null,
      writable: true,
      envVar: 'GROQ_API_KEY',
      settings: DEFAULT_SETTINGS
    })
    assert.equal('key' in body.value, false)
  })
})

test('status with a stored key says configured but exposes no key material', async () => {
  await withTempHome(async () => {
    const { ctx, calls } = createFakeCtx({ key: SECRET })
    const { status, body } = await dispatchAction(ctx, { action: 'status' })
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
    const { body } = await dispatchAction(ctx, { action: 'status' })
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
        'unknown-action'
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
      polish: { provider: 'p', model: 'm', prompt: 'Fix.' }
    })

    const { status, body } = await dispatchAction(ctx, { action: 'get-settings' })
    assert.equal(status, 200)
    assert.deepEqual(body.value.settings, {
      model: 'whisper-large-v3',
      language: 'de',
      polish: { provider: 'p', model: 'm', prompt: 'Fix.' }
    })
  })
})

test('set-settings validates, persists and returns the stored document', async () => {
  await withTempHome(async () => {
    const { ctx } = createFakeCtx()
    const { status, body } = await dispatchAction(ctx, {
      action: 'set-settings',
      patch: {
        model: 'whisper-large-v3',
        language: 'ru',
        polish: { provider: 'openai', model: 'gpt-4o-mini', prompt: 'Polish.' }
      }
    })

    assert.equal(status, 200)
    assert.deepEqual(body.value.settings, {
      model: 'whisper-large-v3',
      language: 'ru',
      polish: { provider: 'openai', model: 'gpt-4o-mini', prompt: 'Polish.' }
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
        'bad-request'
      )
    }

    const { body } = await dispatchAction(ctx, {
      action: 'set-settings',
      patch: { model: 'gpt-4', language: 'EN-us', polish: { provider: 'x', model: 'y' } }
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
          { name: 'no id' }
        ],
        async listModels (provider) {
          if (provider === 'broken') throw new Error('adapter exploded')
          if (provider === 'alpha') {
            return [
              { id: 'alpha-large', name: 'Alpha Large' },
              { id: 'alpha-small' }
            ]
          }
          return [{ id: 'bare-model', name: 'Bare Model' }]
        }
      }
    }).ctx

    const { status, body } = await dispatchAction(ctx, { action: 'list-models' })
    assert.equal(status, 200)
    assert.deepEqual(body.value, [
      { provider: 'alpha', providerName: 'Alpha Provider', model: 'alpha-large', modelName: 'Alpha Large' },
      { provider: 'alpha', providerName: 'Alpha Provider', model: 'alpha-small', modelName: 'alpha-small' },
      { provider: 'bare', providerName: 'bare', model: 'bare-model', modelName: 'Bare Model' }
    ])
  })
})

test('list-models returns an empty list when the LLM service is unusable', async () => {
  await withTempHome(async () => {
    const { ctx } = createFakeCtx({ llm: { listProviders: () => { throw new Error('no llm') } } })
    const { body } = await dispatchAction(ctx, { action: 'list-models' })
    assert.deepEqual(body.value, [])
  })
})

test('list-models uses the agent Groq route without the Groq key', async () => {
  await withTempHome(async () => {
    const fake = createFakeCtx({
      key: SECRET,
      llm: {
        listProviders: () => [{ id: 'groq', name: 'groq' }],
        async listModels (provider) {
          assert.equal(provider, 'groq')
          return [
            { id: 'openai/gpt-oss-120b', name: 'GPT OSS 120B' },
            { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B' }
          ]
        }
      }
    })

    const { status, body } = await dispatchAction(fake.ctx, { action: 'list-models' })
    assert.equal(status, 200)
    assert.deepEqual(body.value, [
      { provider: 'groq', providerName: 'groq', model: 'openai/gpt-oss-120b', modelName: 'GPT OSS 120B' },
      { provider: 'groq', providerName: 'groq', model: 'llama-3.1-8b-instant', modelName: 'Llama 3.1 8B' }
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
      'unknown-action'
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
        body: '{"action":"status"}'
      })
      assert.equal(crossSite.status, 403)
      assert.deepEqual(await crossSite.json(), {
        ok: false,
        error: { code: 'forbidden', message: 'Forbidden' }
      })

      const wrongMethod = await fetch(url, { method: 'GET' })
      assert.equal(wrongMethod.status, 405)

      const wrongType = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: '{"action":"status"}'
      })
      assert.equal(wrongType.status, 415)

      const unknown = await fetch(url, {
        method: 'POST',
        headers: jsonHeaders,
        body: '{"action":"nope"}'
      })
      assert.equal(unknown.status, 404)
      assert.equal((await unknown.json()).error.code, 'unknown-action')

      const big = await fetch(url, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ action: 'status', padding: 'x'.repeat(70 * 1024) })
      })
      assert.equal(big.status, 413)

      const ok = await fetch(url, {
        method: 'POST',
        headers: { ...jsonHeaders, origin: api.origin },
        body: '{"action":"status"}'
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
