/**
 * @jest-environment node
 */

/**
 * Client module smoke test: the ModuleLoader envelope, the Models link and the
 * settings-section registration without a browser.
 *
 * The UI is plain React.createElement code, so the module can be built with a
 * fake React and a fake slot service.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { createModule, openModelsSection } from '../src/clientModule'

const fakeReact = {
  createElement: (type: unknown, props: unknown, ...children: unknown[]) => ({ type, props, children }),
  useState: (initial: unknown) => [initial, () => {}],
  useEffect: () => {},
  useRef: (initial: unknown) => ({ current: initial }),
}

const root = join(__dirname, '..')
const settingsSource = readFileSync(join(root, 'src/components/Settings/Settings.tsx'), 'utf8')
const clientSource = readFileSync(join(root, 'src/clientModule.ts'), 'utf8')

const loadClient = () => createModule(() => fakeReact as any)

test('client module registers one settings section with the documented metadata', () => {
  const client = loadClient()

  assert.equal(client.inject.includes('slots'), true)

  const injected: string[] = []
  const registrations: Array<{ meta: any, component: unknown }> = []
  const ctx = {
    slots: {
      inject (name: string, register: () => void) {
        injected.push(name)
        register()
      },
      register (meta: any, component: unknown) {
        registrations.push({ meta, component })

        return () => {}
      },
    },
  }

  client.apply(ctx as any)

  assert.deepEqual(injected, ['settings.section'])
  assert.equal(registrations.length, 1)

  const { inject, ...meta } = registrations[0].meta

  assert.deepEqual(meta, {
    name: 'settings.section',
    id: 'groq-speech',
    order: 30,
    label: 'Groq Speech',
  })
  assert.equal(typeof inject, 'function')
  assert.equal(typeof inject().openModels, 'function')
  assert.equal(registrations[0].component, client.GroqSpeechSection)
})

test('the section has no key input and links to Settings → Models', () => {
  assert.equal(settingsSource.includes("type='password'"), false)
  assert.equal(settingsSource.includes('set-key'), false)
  assert.equal(settingsSource.includes('clear-key'), false)
  assert.match(settingsSource, /Settings → Models/)
  assert.match(clientSource, /data-shortcut-modal="settings"/)

  // The shared-key presence is shown as a visible status pill, not only prose.
  assert.match(settingsSource, /Configured/)
  assert.match(settingsSource, /Not configured/)
  assert.match(readFileSync(join(root, 'src/ui/Status/Status.tsx'), 'utf8'), /gqs-badge-/)
})

test('the Models link clicks the nav cell whose slot id is models', () => {
  const clicked: string[] = []
  const originalDocument = (globalThis as any).document
  const panel = {
    querySelectorAll (selector: string) {
      assert.equal(selector, 'nav > div:last-child button')

      return [
        { click: () => clicked.push('general') },
        { click: () => clicked.push('models') },
        { click: () => clicked.push('groq-speech') },
      ]
    },
  }

  ;(globalThis as any).document = {
    querySelector (selector: string) {
      assert.equal(selector, '[data-shortcut-modal="settings"]')

      return panel
    },
  }

  try {
    const ctx = {
      slots: {
        entries (name: string) {
          assert.equal(name, 'settings.section')

          return [
            { options: { id: 'groq-speech', order: 30 } },
            { options: { id: 'models', order: 10 } },
            { options: { id: 'general', order: 0 } },
          ]
        },
      },
    }

    assert.equal(openModelsSection(ctx), true)
    assert.deepEqual(clicked, ['models'])
  } finally {
    ;(globalThis as any).document = originalDocument
  }
})

test('settings autosave and no Save settings button', () => {
  assert.equal(settingsSource.includes('Save settings'), false)
  assert.match(settingsSource, /scheduleSettingsSave/)
  assert.match(settingsSource, /set-settings/)
  assert.match(settingsSource, /MAX_PROMPT_CHARS/)
})
