/**
 * Client bundle smoke test: verify the ModuleLoader envelope, the Models link
 * and the settings-section registration without a browser.
 *
 * The client is plain script (no JSX, no bundler), so it can be evaluated in a
 * `node:vm` sandbox with a minimal fake `window` and a fake `react`.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

const fakeReact = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: (initial) => [initial, () => {}],
  useEffect: () => {},
  useRef: (initial) => ({ current: initial })
}

/** Evaluate the bundle and return the object it registered. */
function loadBundle (globals = {}) {
  let exported
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load (definition) {
          assert.equal(definition.id, 'dsh-groq-speech')
          exported = definition.factory(() => fakeReact)
        }
      }
    },
    console,
    ...globals
  }
  vm.runInNewContext(source, sandbox, { filename: 'lib/client.js' })
  assert.ok(exported && typeof exported === 'object', 'the bundle must register a module')
  return exported
}

test('client bundle registers one settings section with the documented metadata', () => {
  const client = loadBundle()
  assert.equal(client.inject.includes('slots'), true)

  const injected = []
  const registrations = []
  const ctx = {
    slots: {
      inject (name, register) {
        injected.push(name)
        register()
      },
      register (meta, component) {
        registrations.push({ meta, component })
        return () => {}
      }
    }
  }

  client.apply(ctx)
  assert.deepEqual(injected, ['settings.section'])
  assert.equal(registrations.length, 1)
  const { inject, ...meta } = registrations[0].meta
  assert.deepEqual(meta, {
    name: 'settings.section',
    id: 'groq-speech',
    order: 30,
    label: 'Groq Speech'
  })
  assert.equal(typeof inject, 'function')
  assert.equal(typeof inject().openModels, 'function')
  assert.equal(registrations[0].component, client.GroqSpeechSection)
})

test('the section has no key input and links to Settings → Models', () => {
  const client = loadBundle()
  assert.equal('MASKED_KEY' in client, false)
  assert.equal(source.includes('type: "password"'), false)
  assert.equal(source.includes('set-key'), false)
  assert.equal(source.includes('clear-key'), false)
  assert.match(source, /Settings → Models/)
  assert.match(source, /data-shortcut-modal="settings"/)

  // The shared-key presence is shown as a visible status pill, not only prose.
  assert.match(source, /"Configured" : "Not configured"/)
  assert.match(source, /gqs-badge-on/)
  assert.match(source, /gqs-badge-off/)

  // The bundle must never contain a hard-coded credential.
  assert.equal(/gsk_[A-Za-z0-9]{10,}/.test(source), false)
})

test('the Models link clicks the nav cell whose slot id is models', () => {
  const clicked = []
  const panel = {
    querySelectorAll (selector) {
      assert.equal(selector, 'nav > div:last-child button')
      return [
        { click: () => clicked.push('general') },
        { click: () => clicked.push('models') },
        { click: () => clicked.push('groq-speech') }
      ]
    }
  }
  const client = loadBundle({
    document: {
      querySelector (selector) {
        assert.equal(selector, '[data-shortcut-modal="settings"]')
        return panel
      }
    }
  })
  const ctx = {
    slots: {
      entries (name) {
        assert.equal(name, 'settings.section')
        return [
          { options: { id: 'groq-speech', order: 30 } },
          { options: { id: 'models', order: 10 } },
          { options: { id: 'general', order: 0 } }
        ]
      }
    }
  }

  assert.equal(client.openModelsSection(ctx), true)
  assert.deepEqual(clicked, ['models'])
})

test('settings autosave and no Save settings button', () => {
  loadBundle()
  assert.equal(source.includes('Save settings'), false)
  assert.match(source, /scheduleSettingsSave/)
  assert.match(source, /callApi\("set-settings"/)
  assert.match(source, /maxLength: MAX_PROMPT_CHARS/)
})
