/**
 * Host-side settings for dsh-groq-speech.
 *
 * Stored at `$DSH_HOME/dsh-groq-speech/groq-speech.json` (or
 * `~/.dsh/dsh-groq-speech/groq-speech.json`). The file is validated on every
 * read and write and never contains the Groq API key — the key belongs to
 * `ctx.credentials` only.
 *
 * The 0.1.0 layout kept the file directly in `$DSH_HOME`; that location is
 * still read when the new file is missing, so an upgrade keeps the user's
 * recognition and polish settings.
 */

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import { writeSecretFile } from './atomicFile'
import {
  DEFAULT_MODEL,
  DEFAULT_SETTINGS,
  LEGACY_SETTINGS_FILENAME,
  MAX_PROMPT_CHARS,
  MODELS,
  PLUGIN_DIR_NAME,
  SETTINGS_FILENAME,
} from './constants'
import type { GroqSpeechSettings, PolishSettings, WhisperModel } from './contracts'

/** Old direct-Groq polish route; DSH now exposes Groq as a normal route. */
const LEGACY_GROQ_POLISH_PROVIDER = 'groq-api'
const DSH_GROQ_PROVIDER = 'groq'

/** Provider/model names stored for the polish pass: no control chars. */
const MAX_NAME_CHARS = 200

/** Anything in C0/C1 plus DEL cannot appear in a provider/model id. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/

/** Language hints accepted by the store (the picker offers a narrower list). */
const LANGUAGE_CODE = /^[a-z]{2,3}$/

/**
 * Expand a leading `~` to the current user's home directory. `~user/...` is
 * deliberately left alone, matching the harness home-path helper.
 *
 * @param value configured path.
 * @returns the path with `~` (or `~/`) expanded.
 */
function expandHome (value: string): string {
  if (value === '~') return homedir()
  if (value.startsWith('~/') || value.startsWith('~\\')) return join(homedir(), value.slice(2))

  return value
}

/**
 * Resolve the DeepSeek Harness home: `$DSH_HOME` when set, otherwise `~/.dsh`.
 *
 * The configured value is `~`-expanded and resolved to an absolute path, so
 * `DSH_HOME=~/harness` means `$HOME/harness` — never a literal `./~` directory
 * relative to the server's working directory.
 *
 * Kept local on purpose — the host half must load with no runtime dependency
 * beyond Node built-ins, so no `@deepseek-ai/*` helper package is imported here.
 *
 * @param env environment to read `DSH_HOME` from.
 * @returns the absolute harness home directory.
 */
export function dshHomeDir (env: NodeJS.ProcessEnv = process.env): string {
  const configured = env && typeof env.DSH_HOME === 'string' ? env.DSH_HOME.trim() : ''

  return resolve(configured === '' ? join(homedir(), '.dsh') : expandHome(configured))
}

/**
 * Plugin-owned data directory under the DSH home.
 *
 * @param env environment to read `DSH_HOME` from.
 * @returns `$DSH_HOME/dsh-groq-speech`.
 */
export function pluginDir (env: NodeJS.ProcessEnv = process.env): string {
  return join(dshHomeDir(env), PLUGIN_DIR_NAME)
}

/**
 * Current settings path, inside the plugin data directory.
 *
 * @param env environment to read `DSH_HOME` from.
 * @returns absolute path to `groq-speech.json`.
 */
export function settingsPath (env: NodeJS.ProcessEnv = process.env): string {
  return join(pluginDir(env), SETTINGS_FILENAME)
}

/**
 * 0.1.0 settings path, directly inside the DSH home.
 *
 * @param env environment to read `DSH_HOME` from.
 * @returns absolute path to the legacy `groq-speech.json`.
 */
export function legacySettingsPath (env: NodeJS.ProcessEnv = process.env): string {
  return join(dshHomeDir(env), LEGACY_SETTINGS_FILENAME)
}

function isPlainObject (value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function normalizeLanguage (value: unknown): string {
  return typeof value === 'string' && LANGUAGE_CODE.test(value) ? value : 'auto'
}

function normalizeName (value: unknown): string {
  if (typeof value !== 'string') return ''

  const trimmed = value.trim()

  if (trimmed === '' || CONTROL_CHARS.test(trimmed)) return ''

  return trimmed.slice(0, MAX_NAME_CHARS)
}

/**
 * Validate and normalize a settings document.
 *
 * Unknown keys are dropped; invalid values fall back to defaults instead of
 * throwing, so a hand-edited file can never break plugin startup or a request.
 *
 * @param value parsed JSON or a partial patch.
 * @returns a fully populated settings document.
 */
export function normalizeSettings (value: unknown): GroqSpeechSettings {
  const source = isPlainObject(value) ? value : {}
  const polish = isPlainObject(source.polish) ? source.polish : {}
  const provider = normalizeName(polish.provider)

  return {
    model: MODELS.includes(source.model as WhisperModel) ? source.model as WhisperModel : DEFAULT_MODEL,
    language: normalizeLanguage(source.language),
    polish: {
      provider: provider === LEGACY_GROQ_POLISH_PROVIDER ? DSH_GROQ_PROVIDER : provider,
      model: normalizeName(polish.model),
      prompt: typeof polish.prompt === 'string' ? polish.prompt.slice(0, MAX_PROMPT_CHARS) : '',
    },
  }
}

/**
 * Merge a partial settings patch over the current document, then normalize.
 *
 * Only the documented fields survive; a non-object `polish` patch leaves the
 * current polish settings untouched.
 *
 * @param current current settings document.
 * @param patch partial update from the browser.
 * @returns the merged, normalized document.
 */
export function mergeSettings (current: unknown, patch: unknown): GroqSpeechSettings {
  const base = normalizeSettings(current)

  if (!isPlainObject(patch)) return base

  const next: Record<string, unknown> = {
    model: Object.prototype.hasOwnProperty.call(patch, 'model') ? patch.model : base.model,
    language: Object.prototype.hasOwnProperty.call(patch, 'language') ? patch.language : base.language,
    polish: { ...base.polish },
  }

  if (isPlainObject(patch.polish)) {
    const polish = next.polish as unknown as PolishSettings

    for (const key of ['provider', 'model', 'prompt'] as const) {
      if (Object.prototype.hasOwnProperty.call(patch.polish, key)) {
        (polish as unknown as Record<string, unknown>)[key] = patch.polish[key]
      }
    }
  }

  return normalizeSettings(next)
}

/**
 * Read one settings file, or null when it is missing or unreadable.
 *
 * @param file absolute path.
 * @returns the parsed document, or null.
 */
function readSettingsFile (file: string): GroqSpeechSettings | null {
  try {
    return normalizeSettings(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    return null
  }
}

/**
 * Read and validate the settings file.
 *
 * A missing, unreadable, or malformed file yields the defaults — settings are
 * advisory and must never take a request down. When the current path does not
 * exist yet, the 0.1.0 file in `$DSH_HOME` is used as a one-time source.
 *
 * @param file explicit settings path (tests).
 * @param env environment to read `DSH_HOME` from.
 * @returns the effective settings document.
 */
export function readSettings (file?: string, env: NodeJS.ProcessEnv = process.env): GroqSpeechSettings {
  const target = file ?? settingsPath(env)

  if (existsSync(target)) return readSettingsFile(target) ?? normalizeSettings(DEFAULT_SETTINGS)

  if (file === undefined) {
    const legacy = legacySettingsPath(env)

    if (existsSync(legacy)) return readSettingsFile(legacy) ?? normalizeSettings(DEFAULT_SETTINGS)
  }

  return normalizeSettings(DEFAULT_SETTINGS)
}

/**
 * Validate and persist settings atomically (temp file + rename, mode 0600).
 *
 * @param settings desired settings document.
 * @param file explicit settings path (tests).
 * @returns the persisted document.
 */
export function writeSettings (settings: unknown, file?: string): GroqSpeechSettings {
  const normalized = normalizeSettings(settings)

  writeSecretFile(file ?? settingsPath(), `${JSON.stringify(normalized, null, 2)}\n`)

  return normalized
}
