/**
 * Browser JSON API for the Groq Speech settings section.
 *
 * Every request is fenced to loopback / trusted hosts and same-origin, and no
 * response contains key material: `status` reports only presence, source, and
 * writability from `ctx.credentials.describe()`. Key management is owned by
 * Settings → Models; this API has no action that can set or clear a key.
 */

import {
  KEY_REF,
  MAX_BODY_BYTES
} from './constants.js'
import {
  PAYLOAD_TOO_LARGE,
  isTrustedApiRequest,
  readJsonBody,
  safeErrorMessage,
  writeError,
  writeJson
} from './fence.js'
import { describeGroqKey } from './provider.js'
import {
  mergeSettings,
  normalizeSettings,
  readSettings,
  writeSettings
} from './settings.js'

/**
 * A browser-facing failure with an HTTP status and stable code.
 * Messages here are fixed strings; callers never pass secrets in.
 */
export class ApiFailure extends Error {
  /**
   * @param {number} status
   * @param {string} code
   * @param {string} message
   */
  constructor (status, code, message) {
    super(message)
    this.name = 'ApiFailure'
    this.status = status
    this.code = code
  }
}

/** @param {unknown} value */
function isPlainObject (value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Execute one parsed API action.
 *
 * Returns an HTTP status plus the exact response envelope; throws
 * {@link ApiFailure} for a client-visible failure.
 * @param {object} ctx - host context.
 * @param {object} payload - parsed request body carrying `action`.
 * @param {object} [options]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @returns {Promise<{status: number, body: object}>}
 */
export async function dispatchAction (ctx, payload, options = {}) {
  const env = options.env || process.env
  const action = payload !== null && typeof payload === 'object' ? payload.action : undefined

  if (action === 'status') {
    const key = await describeGroqKey(ctx, env)
    return ok({
      configured: key.configured,
      source: key.source,
      writable: key.writable,
      envVar: KEY_REF,
      settings: readSettings()
    })
  }

  if (action === 'get-settings') {
    return ok({ settings: readSettings() })
  }

  if (action === 'set-settings') {
    if (!isPlainObject(payload.patch)) {
      throw new ApiFailure(400, 'bad-request', 'patch must be a plain object')
    }
    const settings = mergeSettings(readSettings(), payload.patch)
    try {
      writeSettings(settings)
    } catch {
      throw new ApiFailure(500, 'settings-write-failed', 'Could not save settings')
    }
    return ok({ settings: normalizeSettings(settings) })
  }

  if (action === 'list-models') {
    const routes = []
    const llm = ctx !== null && typeof ctx === 'object' ? ctx.llm : undefined
    if (llm !== null && typeof llm === 'object' && typeof llm.listProviders === 'function') {
      let providers = []
      try {
        providers = llm.listProviders()
      } catch {
        providers = []
      }
      for (const provider of Array.isArray(providers) ? providers : []) {
        if (!isPlainObject(provider) || typeof provider.id !== 'string') continue
        let models = []
        try {
          models = await llm.listModels(provider.id)
        } catch {
          // One broken adapter must not hide every other route.
          continue
        }
        for (const model of Array.isArray(models) ? models : []) {
          if (!isPlainObject(model) || typeof model.id !== 'string') continue
          routes.push({
            provider: provider.id,
            providerName: typeof provider.name === 'string' ? provider.name : provider.id,
            model: model.id,
            modelName: typeof model.name === 'string' ? model.name : model.id
          })
        }
      }
    }
    return ok(routes)
  }

  throw new ApiFailure(404, 'unknown-action', 'Unknown action')
}

/** @param {unknown} value */
function ok (value) {
  return { status: 200, body: { ok: true, value } }
}

/**
 * Handle one HTTP request against the browser API.
 * @param {object} ctx - host context.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {object} [options]
 * @param {readonly string[]} [options.trustedHosts]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @returns {Promise<void>}
 */
export async function handleApiRequest (ctx, req, res, options = {}) {
  try {
    if (!isTrustedApiRequest(req, options.trustedHosts || [])) {
      writeError(res, 403, 'forbidden', 'Forbidden')
      return
    }

    if (req.method !== 'POST') {
      writeError(res, 405, 'method-error', 'Method not allowed')
      return
    }

    const contentType = typeof req.headers['content-type'] === 'string'
      ? req.headers['content-type'].toLowerCase()
      : ''
    if (!contentType.startsWith('application/json')) {
      writeError(res, 415, 'unsupported-media-type', 'Content-Type must be application/json')
      return
    }

    const declared = Number(req.headers['content-length'])
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      res.setHeader('connection', 'close')
      writeError(res, 413, 'payload-too-large', 'Request body too large')
      return
    }

    const payload = await readJsonBody(req, MAX_BODY_BYTES)
    if (payload === PAYLOAD_TOO_LARGE) {
      // The body was not fully consumed; do not keep the socket half-drained.
      res.setHeader('connection', 'close')
      writeError(res, 413, 'payload-too-large', 'Request body too large')
      return
    }
    if (!isPlainObject(payload) || typeof payload.action !== 'string') {
      writeError(res, 400, 'bad-request', 'Request body must carry a string action')
      return
    }

    const result = await dispatchAction(ctx, payload, options)
    writeJson(res, result.status, result.body)
  } catch (error) {
    if (error instanceof ApiFailure) {
      writeError(res, error.status, error.code, error.message)
      return
    }
    // Never echo internal errors (or anything they may contain) to the browser.
    console.error('[dsh-groq-speech] API error:', safeErrorMessage(error instanceof Error ? error.message : undefined))
    writeError(res, 500, 'internal', 'Internal error')
  }
}

/**
 * Build the `webServer` prefix handler.
 * @param {object} ctx - host context.
 * @param {object} [options]
 * @param {readonly string[]} [options.trustedHosts]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>}
 */
export function createApiHandler (ctx, options = {}) {
  return (req, res) => handleApiRequest(ctx, req, res, options)
}
