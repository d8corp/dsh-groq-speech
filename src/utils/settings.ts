import { DEFAULT_MODEL, KEY_REF } from '../constants'
import type { ClientStatus, GroqSpeechSettings, KeySource, VoiceInputStatus } from '../contracts'

function isPlainObject (value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeSource (value: unknown): KeySource | null {
  return value === 'stored' || value === 'env' ? value : null
}

/**
 * Normalize the official voice-input selection.
 *
 * @param value raw host response.
 * @returns a safe selection document; unavailable by default.
 */
export function normalizeVoice (value: unknown): VoiceInputStatus {
  const source = isPlainObject(value) ? value : {}

  const providerId = typeof source.providerId === 'string' && source.providerId !== ''
    ? source.providerId
    : null

  return {
    available: source.available === true,
    selectable: source.selectable === true,
    providerId,
    providerName: typeof source.providerName === 'string' && source.providerName !== ''
      ? source.providerName
      : providerId,
    selected: source.selected === true,
  }
}

/**
 * Normalize the `status` value, keeping any embedded settings blob.
 *
 * @param value raw host response.
 * @returns a safe client-side status document.
 */
export function normalizeStatus (value: unknown): ClientStatus {
  const source = isPlainObject(value) ? value : {}
  const settings = isPlainObject(source.settings) ? normalizeSettings(source.settings) : null

  return {
    configured: source.configured === true,
    source: normalizeSource(source.source),
    writable: source.writable !== false,
    envVar: typeof source.envVar === 'string' && source.envVar ? source.envVar : KEY_REF,
    settings,
    voice: normalizeVoice(source.voice),
  }
}

/**
 * Normalize a settings document to the shape the form edits.
 *
 * @param value raw settings from the host or a local edit.
 * @returns a fully populated settings document.
 */
export function normalizeSettings (value: unknown): GroqSpeechSettings {
  const source = isPlainObject(value) ? value : {}
  const polish = isPlainObject(source.polish) ? source.polish : {}
  const model = typeof source.model === 'string' && source.model ? source.model : DEFAULT_MODEL

  return {
    model: model as GroqSpeechSettings['model'],
    language: typeof source.language === 'string' && source.language ? source.language : 'auto',
    polish: {
      provider: typeof polish.provider === 'string' ? polish.provider : '',
      model: typeof polish.model === 'string' ? polish.model : '',
      prompt: typeof polish.prompt === 'string' ? polish.prompt : '',
    },
  }
}

/**
 * Stable comparison string for the fields the autosave persists.
 *
 * @param value settings-shaped value.
 * @returns a JSON snapshot.
 */
export function settingsSnapshot (value: unknown): string {
  const settings = normalizeSettings(value)

  return JSON.stringify({
    model: settings.model,
    language: settings.language,
    polish: {
      provider: settings.polish.provider,
      model: settings.polish.model,
      prompt: settings.polish.prompt,
    },
  })
}
