/**
 * Plugin entry: identity, inject list and the two effect-scoped registrations.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { apply, inject, name } from '../lib/index.js'
import { API_PREFIX } from '../lib/constants.js'
import { createFakeCtx } from './helpers/fake-ctx.js'

test('entry exports the documented identity and injected services', () => {
  assert.equal(name, 'groq-speech')
  assert.deepEqual(inject, ['speechToText', 'webServer', 'webStartup', 'credentials', 'llm'])
})

test('apply registers the provider and the prefix route inside effects', () => {
  const fake = createFakeCtx()
  apply(fake.ctx)

  assert.deepEqual(fake.effects, ['dsh-groq-speech: provider', 'dsh-groq-speech: api'])
  assert.equal(fake.calls.providers.length, 1)
  assert.equal(fake.calls.providers[0].info.id, 'groq-whisper')
  assert.equal(typeof fake.calls.providers[0].transcribe, 'function')

  assert.equal(fake.calls.routes.length, 1)
  assert.equal(fake.calls.routes[0].kind, 'prefix')
  assert.equal(fake.calls.routes[0].path, API_PREFIX)
  assert.equal(typeof fake.calls.routes[0].handler, 'function')
})

test('apply tolerates missing webStartup and warns about invalid trusted hosts', () => {
  const warnings = []
  const originalWarn = console.warn
  console.warn = (...args) => warnings.push(args.join(' '))
  try {
    const fake = createFakeCtx({ trustedHosts: ['definitely not a host'] })
    fake.ctx.webStartup = undefined
    assert.doesNotThrow(() => apply(fake.ctx))
    assert.equal(fake.calls.routes.length, 1)

    const withHosts = createFakeCtx({ trustedHosts: ['definitely not a host', 'example.test:8443'] })
    assert.doesNotThrow(() => apply(withHosts.ctx))
    assert.equal(withHosts.calls.routes.length, 1)
  } finally {
    console.warn = originalWarn
  }
  assert.ok(warnings.some((message) => message.includes('invalid trusted host')))
})

test('apply performs no registration when effects are not run', () => {
  const fake = createFakeCtx({ effect: false })
  apply(fake.ctx)
  assert.equal(fake.calls.providers.length, 0)
  assert.equal(fake.calls.routes.length, 0)
})
