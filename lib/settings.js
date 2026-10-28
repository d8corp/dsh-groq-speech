/**
 * Host-side settings for dsh-groq-speech.
 *
 * The file lives at `$DSH_HOME/groq-speech.json` (or `~/.dsh/groq-speech.json`),
 * is validated on every read and write, and never contains the Groq API key —
 * the key belongs to `ctx.credentials` only.
 */

import { randomBytes } from 'node:crypto'
import {
  chmodSync,
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  DEFAULT_MODEL,
  DEFAULT_SETTINGS,
  MODELS,
  SETTINGS_FILE
} from './constants.js'

/** Old direct-Groq polish route; DSH now exposes Groq as a normal route. */
const LEGACY_GROQ_POLISH_PROVIDER = 'groq-api'
const DSH_GROQ_PROVIDER = 'groq'

/** Provider/model names stored for the polish pass: no control chars. */
const MAX_NAME_CHARS = 200
/** Maximum stored polish prompt length. */
const MAX_PROMPT_CHARS = 4000
/** Anything in C0/C1 plus DEL cannot appear in a provider/model id. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/
/** Language hints accepted by the store (the picker offers a narrower list). */
const LANGUAGE_CODE = /^[a-z]{2,3}$/

/**
 * Resolve the settings file path for the current process.
 * @param {NodeJS.ProcessEnv} [env] - environment to read `DSH_HOME` from.
 * @returns {string} absolute path to `groq-speech.json`.
 */
export function settingsPath (env = process.env) {
  const home = env && typeof env.DSH_HOME === 'string' && env.DSH_HOME.trim() !== ''
    ? env.DSH_HOME.trim()
    : join(homedir(), '.dsh')
  return join(home, SETTINGS_FILE)
}

/** @param {unknown} value */
function isPlainObject (value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** @param {unknown} value */
function normalizeLanguage (value) {
  return typeof value === 'string' && LANGUAGE_CODE.test(value) ? value : 'auto'
}

/** @param {unknown} value */
function normalizeName (value) {
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
 * @param {unknown} value - parsed JSON or a partial patch.
 * @returns {{model: string, language: string, polish: {provider: string, model: string, prompt: string}}}
 */
export function normalizeSettings (value) {
  const source = isPlainObject(value) ? value : {}
  const polish = isPlainObject(source.polish) ? source.polish : {}
  const provider = normalizeName(polish.provider)
  return {
    model: MODELS.includes(source.model) ? source.model : DEFAULT_MODEL,
    language: normalizeLanguage(source.language),
    polish: {
      provider: provider === LEGACY_GROQ_POLISH_PROVIDER ? DSH_GROQ_PROVIDER : provider,
      model: normalizeName(polish.model),
      prompt: typeof polish.prompt === 'string' ? polish.prompt.slice(0, MAX_PROMPT_CHARS) : ''
    }
  }
}

/**
 * Merge a partial settings patch over the current document, then normalize.
 *
 * Only the documented fields survive; a non-object `polish` patch leaves the
 * current polish settings untouched.
 * @param {unknown} current - current settings document.
 * @param {unknown} patch - partial update from the browser.
 * @returns {ReturnType<typeof normalizeSettings>}
 */
export function mergeSettings (current, patch) {
  const base = normalizeSettings(current)
  if (!isPlainObject(patch)) return base

  const next = {
    model: Object.prototype.hasOwnProperty.call(patch, 'model') ? patch.model : base.model,
    language: Object.prototype.hasOwnProperty.call(patch, 'language') ? patch.language : base.language,
    polish: { ...base.polish }
  }

  if (isPlainObject(patch.polish)) {
    for (const key of ['provider', 'model', 'prompt']) {
      if (Object.prototype.hasOwnProperty.call(patch.polish, key)) next.polish[key] = patch.polish[key]
    }
  }

  return normalizeSettings(next)
}

/**
 * Read and validate the settings file.
 *
 * A missing, unreadable, or malformed file yields the defaults — settings are
 * advisory and must never take a request down.
 * @param {string} [file] - explicit settings path (tests).
 * @returns {ReturnType<typeof normalizeSettings>}
 */
export function readSettings (file = settingsPath()) {
  try {
    return normalizeSettings(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    return normalizeSettings(DEFAULT_SETTINGS)
  }
}

/**
 * Validate and persist settings atomically (temp file + rename, mode 0600).
 *
 * The temporary file is created in the same directory as the target so the
 * rename is atomic on POSIX filesystems; a crash can leave the old file whole,
 * never a truncated replacement.
 * @param {unknown} settings - desired settings document.
 * @param {string} [file] - explicit settings path (tests).
 * @returns {ReturnType<typeof normalizeSettings>} the persisted document.
 */
export function writeSettings (settings, file = settingsPath()) {
  const normalized = normalizeSettings(settings)
  const directory = dirname(file)
  mkdirSync(directory, { recursive: true })

  const temp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  const payload = `${JSON.stringify(normalized, null, 2)}\n`

  let handle
  try {
    handle = openSync(temp, 'w', 0o600)
    writeFileSync(handle, payload, 'utf8')
    fsyncSync(handle)
    closeSync(handle)
    handle = undefined
  } catch (error) {
    if (handle !== undefined) {
      try { closeSync(handle) } catch { /* already closed */ }
    }
    try { unlinkSync(temp) } catch { /* nothing to clean up */ }
    throw error
  }

  try {
    renameSync(temp, file)
  } catch (error) {
    try { unlinkSync(temp) } catch { /* nothing to clean up */ }
    throw error
  }

  // `mode` on open only applies when the file is created; an existing 0644
  // file would otherwise keep its old permissions after the rename.
  try { chmodSync(file, 0o600) } catch { /* non-POSIX filesystem */ }

  return normalized
}
