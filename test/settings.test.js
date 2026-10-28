/**
 * Settings store: defaults, validation, atomic persistence and file hygiene.
 *
 * Every test runs in a fresh temporary `DSH_HOME` so the developer's real
 * settings file is never touched.
 */

import assert from 'node:assert/strict'
import { chmodSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  DEFAULT_MODEL,
  DEFAULT_SETTINGS,
  LANGUAGES,
  SETTINGS_FILE
} from '../lib/constants.js'
import {
  mergeSettings,
  normalizeSettings,
  readSettings,
  settingsPath,
  writeSettings
} from '../lib/settings.js'
import { withTempHome } from './helpers/env.js'

const fileIn = (home) => join(home, SETTINGS_FILE)

test('readSettings returns defaults when the file does not exist', async () => {
  await withTempHome(async (home) => {
    const settings = readSettings()
    assert.deepEqual(settings, {
      model: DEFAULT_MODEL,
      language: 'auto',
      polish: { provider: '', model: '', prompt: '' }
    })
    assert.equal(existsSync(fileIn(home)), false)
  })
})

test('settingsPath honors DSH_HOME and trims surrounding whitespace', () => {
  assert.equal(settingsPath({ DSH_HOME: '  /tmp/dsh-home  ' }), '/tmp/dsh-home/groq-speech.json')
  assert.equal(settingsPath({}), join(homedir(), '.dsh', SETTINGS_FILE))
  assert.equal(settingsPath({ DSH_HOME: '   ' }), join(homedir(), '.dsh', SETTINGS_FILE))
})

test('normalizeSettings validates model, language and polish fields', () => {
  assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS)
  assert.deepEqual(normalizeSettings({}), DEFAULT_SETTINGS)
  assert.deepEqual(normalizeSettings([]), DEFAULT_SETTINGS)

  assert.equal(normalizeSettings({ model: 'whisper-large-v3' }).model, 'whisper-large-v3')
  assert.equal(normalizeSettings({ model: 'not-a-model' }).model, DEFAULT_MODEL)
  assert.equal(normalizeSettings({ model: 42 }).model, DEFAULT_MODEL)

  assert.equal(normalizeSettings({ language: 'ru' }).language, 'ru')
  assert.equal(normalizeSettings({ language: 'yue' }).language, 'yue')
  assert.equal(normalizeSettings({ language: 'auto' }).language, 'auto')
  assert.equal(normalizeSettings({ language: 'RU' }).language, 'auto')
  assert.equal(normalizeSettings({ language: 'en-US' }).language, 'auto')
  assert.equal(normalizeSettings({ language: 'english' }).language, 'auto')
  assert.equal(normalizeSettings({ language: 7 }).language, 'auto')

  assert.equal(normalizeSettings({ polish: { provider: '  openai  ' } }).polish.provider, 'openai')
  assert.equal(normalizeSettings({ polish: { provider: 'groq-api' } }).polish.provider, 'groq')
  assert.equal(normalizeSettings({ polish: { provider: 'bad\u0000id' } }).polish.provider, '')
  assert.equal(normalizeSettings({ polish: { model: 'bad\u009fid' } }).polish.model, '')
  assert.equal(normalizeSettings({ polish: { prompt: 'x'.repeat(5000) } }).polish.prompt.length, 4000)
  assert.deepEqual(normalizeSettings({ polish: 'nope' }).polish, {
    provider: '',
    model: '',
    prompt: ''
  })
  assert.equal('enabled' in normalizeSettings({ polish: { enabled: true } }).polish, false)
})

test('normalizeSettings drops unknown keys, including secrets', () => {
  const normalized = normalizeSettings({
    model: 'whisper-large-v3',
    apiKey: 'gsk_should_never_be_here',
    GROQ_API_KEY: 'gsk_should_never_be_here',
    extra: { nested: true }
  })
  assert.deepEqual(Object.keys(normalized).sort(), ['language', 'model', 'polish'])
  assert.equal('apiKey' in normalized, false)
  assert.equal('GROQ_API_KEY' in normalized, false)
  assert.equal('extra' in normalized, false)
})

test('mergeSettings applies partial patches without losing other fields', () => {
  const base = {
    model: 'whisper-large-v3',
    language: 'de',
    polish: { provider: 'p', model: 'm', prompt: 'keep me' }
  }

  const modelOnly = mergeSettings(base, { model: 'distil-whisper-large-v3-en' })
  assert.equal(modelOnly.model, 'distil-whisper-large-v3-en')
  assert.equal(modelOnly.language, 'de')
  assert.deepEqual(modelOnly.polish, base.polish)

  const polishOnly = mergeSettings(base, { polish: { prompt: 'new prompt' } })
  assert.equal(polishOnly.polish.provider, 'p')
  assert.equal(polishOnly.polish.model, 'm')
  assert.equal(polishOnly.polish.prompt, 'new prompt')

  assert.deepEqual(mergeSettings(base, 'nope'), normalizeSettings(base))
  assert.deepEqual(mergeSettings(base, { polish: null }), normalizeSettings(base))
})

test('writeSettings persists validated settings atomically with mode 0600', async () => {
  await withTempHome(async (home) => {
    const persisted = writeSettings({
      model: 'whisper-large-v3',
      language: 'ru',
      polish: { provider: 'openai', model: 'gpt-4o-mini', prompt: 'Fix it.' }
    })

    const file = fileIn(home)
    assert.equal(existsSync(file), true)
    assert.equal(statSync(file).mode & 0o777, 0o600)
    assert.deepEqual(readdirSync(home), [SETTINGS_FILE], 'no temporary files are left behind')
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), persisted)
    assert.deepEqual(readSettings(), persisted)
  })
})

test('writeSettings normalizes invalid input and never stores the API key', async () => {
  await withTempHome(async (home) => {
    writeSettings({
      model: 'gpt-4',
      language: 'EN-us',
      polish: { provider: 7 },
      apiKey: 'gsk_live_secret_material',
      GROQ_API_KEY: 'gsk_live_secret_material'
    })

    const raw = readFileSync(fileIn(home), 'utf8')
    assert.equal(raw.includes('gsk_live_secret_material'), false)
    const parsed = JSON.parse(raw)
    assert.equal(parsed.model, DEFAULT_MODEL)
    assert.equal(parsed.language, 'auto')
    assert.deepEqual(parsed.polish, { provider: '', model: '', prompt: '' })
  })
})

test('writeSettings restores 0600 on an existing world-readable file', async () => {
  await withTempHome(async (home) => {
    writeSettings(readSettings())
    chmodSync(fileIn(home), 0o644)
    writeSettings(readSettings())
    assert.equal(statSync(fileIn(home)).mode & 0o777, 0o600)
  })
})

test('readSettings falls back to defaults for malformed JSON', async () => {
  await withTempHome(async (home) => {
    writeFileSync(fileIn(home), '{ this is not json')
    assert.deepEqual(readSettings(), DEFAULT_SETTINGS)
  })
})

test('language list in constants stays compatible with the settings validator', () => {
  for (const language of LANGUAGES) {
    assert.equal(normalizeSettings({ language }).language, language)
  }
})
