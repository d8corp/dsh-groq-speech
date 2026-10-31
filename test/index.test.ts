/**
 * @jest-environment node
 */

/**
 * Plugin entry: identity, inject list and the two effect-scoped registrations.
 */

import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { API_PREFIX, PACKAGE_NAME } from '../src/constants'
import { apply, inject, name } from '../src/index'
import { withTempHome } from './helpers/env'
import { createFakeCtx } from './helpers/fake-ctx'

test('entry exports the documented identity and injected services', () => {
  assert.equal(name, 'groq-speech')
  assert.deepEqual(inject, ['speechToText', 'webServer', 'webStartup', 'credentials', 'llm'])
})

test('package manifest declares an icon the plugin manager can read', () => {
  const root = process.cwd()
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { icon?: unknown }

  assert.equal(manifest.icon, './icon.png')

  const stat = statSync(join(root, String(manifest.icon)))

  assert.equal(stat.isFile(), true)
  // The DSH plugin manager admits icons up to 256 KiB as a data URL.
  assert.ok(stat.size > 0 && stat.size <= 256 * 1024)
})

test('apply registers the provider and the prefix route inside effects', () => {
  const fake = createFakeCtx()

  apply(fake.ctx as any)

  assert.deepEqual(fake.effects, ['dsh-groq-speech: provider', 'dsh-groq-speech: api'])
  assert.equal(fake.calls.providers.length, 1)
  assert.equal(fake.calls.providers[0].info.id, 'groq-whisper')
  assert.equal(typeof fake.calls.providers[0].transcribe, 'function')

  assert.equal(fake.calls.routes.length, 1)
  assert.equal(fake.calls.routes[0].kind, 'prefix')
  assert.equal(fake.calls.routes[0].path, API_PREFIX)
  assert.equal(typeof fake.calls.routes[0].handler, 'function')
})

test('apply validates trusted hosts once and warns about bad entries', () => {
  const warnings: string[] = []
  const originalWarn = console.warn

  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(' '))
  }

  try {
    const fake = createFakeCtx({ trustedHosts: ['example.test', 'https://bad.test'] })

    apply(fake.ctx as any)

    assert.equal(warnings.length, 1)
    assert.match(warnings[0], /https:\/\/bad\.test/)
  } finally {
    console.warn = originalWarn
  }
})

test('apply starts the uninstall watcher only for a profile declaring the package', async () => {
  await withTempHome(async (home) => {
    const profile = join(home, 'profile')

    mkdirSync(profile, { recursive: true })
    writeFileSync(join(profile, 'package.json'), JSON.stringify({
      dependencies: { [PACKAGE_NAME]: 'file:../release' },
    }))

    const fake = createFakeCtx()

    fake.ctx.baseUrl = `file://${profile}/`

    apply(fake.ctx as any)

    assert.deepEqual(fake.effects, [
      'dsh-groq-speech: provider',
      'dsh-groq-speech: api',
      'dsh-groq-speech: uninstall cleanup',
    ])
  })

  const other = createFakeCtx()

  other.ctx.baseUrl = 'file:///tmp/not-our-profile/'

  apply(other.ctx as any)

  assert.equal(other.effects.includes('dsh-groq-speech: uninstall cleanup'), false)
})
