/**
 * @jest-environment node
 */

/**
 * Client module smoke test: the settings-section registration, the Models link
 * and the source-level UX contract without a browser.
 *
 * React is supplied by the DSH host at runtime, so the Node test environment
 * maps `react` to an empty stub (see jest.config.js) and nothing is rendered.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { apply, inject } from '../src/client'
import { Settings } from '../src/components'

const root = join(__dirname, '..')
const settingsSource = readFileSync(join(root, 'src/components/Settings/Settings.tsx'), 'utf8')
const clientSource = readFileSync(join(root, 'src/client.ts'), 'utf8')

test('client module registers one settings section with the documented metadata', () => {
  assert.equal(inject.includes('slots'), true)

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

  apply(ctx as any)

  assert.deepEqual(injected, ['settings.section'])
  assert.equal(registrations.length, 1)

  const { inject: slotInject, ...meta } = registrations[0].meta

  assert.deepEqual(meta, {
    name: 'settings.section',
    id: 'groq-speech',
    order: 30,
    label: 'Groq Speech',
  })

  assert.equal(typeof slotInject, 'function')
  assert.equal(typeof slotInject().openModels, 'function')
  assert.equal(typeof slotInject().openVoiceInput, 'function')
  assert.equal(registrations[0].component, Settings)
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
    let section: { inject: () => { openModels: () => boolean } } | undefined

    const ctx = {
      slots: {
        inject (name: string, register: () => void) {
          assert.equal(name, 'settings.section')
          register()
        },
        register (meta: any) {
          section = meta

          return () => {}
        },
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

    apply(ctx as any)

    assert.equal(section!.inject().openModels(), true)
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

test('the section shows the voice-input selection and offers a switch', () => {
  assert.match(settingsSource, /Voice input provider/)
  assert.match(settingsSource, /Use Groq Whisper/)
  assert.match(settingsSource, /Voice input settings/)
  assert.match(settingsSource, /select-provider/)
  assert.match(settingsSource, /Selected/)
  assert.match(settingsSource, /Not selected/)
  assert.match(settingsSource, /Not detected/)
  assert.match(clientSource, /openBundle/)
  assert.match(clientSource, /dsh-experimental-voice-input-bundle/)
})

test('the voice-input link opens the official plugin details', () => {
  const opened: string[] = []
  let section: { inject: () => { openVoiceInput: () => boolean } } | undefined

  const ctx = {
    slots: {
      inject (name: string, register: () => void) {
        assert.equal(name, 'settings.section')
        register()
      },
      register (meta: any) {
        section = meta

        return () => {}
      },
      entries () {
        return []
      },
    },
    get (name: string) {
      assert.equal(name, 'pluginNavigation')

      return {
        openBundle (key: string) {
          opened.push(key)
        },
      }
    },
  }

  apply(ctx as any)

  assert.equal(section!.inject().openVoiceInput(), true)
  assert.deepEqual(opened, ['@deepseek-ai/dsh-experimental-voice-input-bundle'])
})

test('the voice-input link reports failure without the navigation service', () => {
  let section: { inject: () => { openVoiceInput: () => boolean } } | undefined

  const ctx = {
    slots: {
      inject (name: string, register: () => void) {
        assert.equal(name, 'settings.section')
        register()
      },
      register (meta: any) {
        section = meta

        return () => {}
      },
      entries () {
        return []
      },
    },
  }

  apply(ctx as any)

  assert.equal(section!.inject().openVoiceInput(), false)
})
