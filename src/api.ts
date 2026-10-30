/**
 * Browser JSON API for the Groq Speech settings section.
 *
 * Every request is fenced to loopback / trusted hosts and same-origin, and no
 * response contains key material: `status` reports only presence, source, and
 * writability from `ctx.credentials.describe()`. Key management is owned by
 * Settings → Models; this API has no action that can set or clear a key.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'

import { KEY_REF, MAX_BODY_BYTES } from './constants'
import type { ModelRoute, StatusPayload } from './contracts'
import {
  isLoopbackRequest,
  isTrustedApiRequest,
  PAYLOAD_TOO_LARGE,
  readJsonBody,
  safeErrorMessage,
  writeError,
  writeJson,
} from './fence'
import { describeGroqKey } from './provider'
import { mergeSettings, normalizeSettings, readSettings, writeSettings } from './settings'

/**
 * A browser-facing failure with an HTTP status and stable code.
 * Messages here are fixed strings; callers never pass secrets in.
 */
export class ApiFailure extends Error {
  readonly status: number
  readonly code: string

  constructor (status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiFailure'
    this.status = status
    this.code = code
  }
}

/**
 * The slice of the DSH `connection` service this plugin relies on. It is
 * looked up lazily so the plugin keeps loading in profiles that have no
 * browser connection, where only loopback requests are accepted.
 */
interface ConnectionLike {
  requestRejection?: (request: IncomingMessage) => unknown
}

interface PluginContext {
  connection?: ConnectionLike
  get?: (name: string) => unknown
}

export type ApiHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>

export interface ApiResult {
  status: number
  body: unknown
}

export interface DispatchOptions {
  /** Environment used for the key fallback (tests). */
  env?: NodeJS.ProcessEnv
}

export interface HandlerOptions {
  trustedHosts?: string[]
  env?: NodeJS.ProcessEnv
}

function isPlainObject (value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Resolve the connection service for browser-session verification.
 *
 * @param ctx plugin context.
 * @returns the service, or undefined when this profile has none.
 */
function resolveConnection (ctx: unknown): ConnectionLike | undefined {
  if (ctx === null || typeof ctx !== 'object') return undefined

  const candidate = ctx as PluginContext
  let direct: ConnectionLike | undefined

  try {
    direct = candidate.connection
  } catch { /* unknown services throw on some context proxies */ }

  if (direct && typeof direct.requestRejection === 'function') return direct

  if (typeof candidate.get === 'function') {
    try {
      const service = candidate.get('connection') as ConnectionLike | undefined

      if (service && typeof service.requestRejection === 'function') return service
    } catch { /* service lookup can fail while the host boots */ }
  }

  return undefined
}

/**
 * Require a live DSH browser session (or API credential) for a request.
 *
 * @param ctx plugin context.
 * @param req incoming request.
 * @returns undefined when admitted, otherwise the HTTP status to return.
 */
function sessionRejection (ctx: unknown, req: IncomingMessage): number | undefined {
  const connection = resolveConnection(ctx)

  // Without a verifier the safe answer for a remote authority is "no".
  if (!connection || typeof connection.requestRejection !== 'function') return 403

  let rejection: unknown

  try {
    rejection = connection.requestRejection(req)
  } catch {
    return 403
  }

  if (rejection === undefined) return undefined

  return rejection === 401 ? 401 : 403
}

function ok (value: unknown): ApiResult {
  return { status: 200, body: { ok: true, value } }
}

/**
 * Execute one parsed API action.
 *
 * Returns an HTTP status plus the exact response envelope; throws
 * {@link ApiFailure} for a client-visible failure.
 *
 * @param ctx host context.
 * @param payload parsed request body carrying `action`.
 * @param options environment override.
 * @returns the response envelope.
 */
export async function dispatchAction (
  ctx: unknown,
  payload: unknown,
  options: DispatchOptions = {},
): Promise<ApiResult> {
  const env = options.env || process.env
  const action = isPlainObject(payload) ? payload.action : undefined

  if (action === 'status') {
    const key = await describeGroqKey(ctx, env)

    const value: StatusPayload = {
      configured: key.configured,
      source: key.source,
      writable: key.writable,
      envVar: KEY_REF,
      settings: readSettings(),
    }

    return ok(value)
  }

  if (action === 'get-settings') {
    return ok({ settings: readSettings() })
  }

  if (action === 'set-settings') {
    if (!isPlainObject(payload) || !isPlainObject(payload.patch)) {
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
    return ok(await listModels(ctx))
  }

  throw new ApiFailure(404, 'unknown-action', 'Unknown action')
}

/**
 * Flatten the DSH model routes into provider/model pairs for the polish picker.
 *
 * One broken adapter must not hide every other route, so a failing provider is
 * skipped while the rest of the list is still returned.
 *
 * @param ctx host context carrying `llm`.
 * @returns the selectable routes, possibly empty.
 */
async function listModels (ctx: unknown): Promise<ModelRoute[]> {
  const routes: ModelRoute[] = []
  const llm = ctx !== null && typeof ctx === 'object' ? (ctx as { llm?: unknown }).llm : undefined

  if (llm === null || typeof llm !== 'object') return routes

  const service = llm as {
    listProviders?: () => unknown
    listModels?: (provider: string) => Promise<unknown> | unknown
  }

  if (typeof service.listProviders !== 'function' || typeof service.listModels !== 'function') return routes

  let providers: unknown = []

  try {
    providers = service.listProviders()
  } catch {
    providers = []
  }

  for (const provider of Array.isArray(providers) ? providers : []) {
    if (!isPlainObject(provider) || typeof provider.id !== 'string') continue

    let models: unknown = []

    try {
      models = await service.listModels(provider.id)
    } catch {
      continue
    }

    for (const model of Array.isArray(models) ? models : []) {
      if (!isPlainObject(model) || typeof model.id !== 'string') continue

      routes.push({
        provider: provider.id,
        providerName: typeof provider.name === 'string' ? provider.name : provider.id,
        model: model.id,
        modelName: typeof model.name === 'string' ? model.name : model.id,
      })
    }
  }

  return routes
}

function contentTypeOf (req: IncomingMessage): string {
  const value = req.headers['content-type']

  return typeof value === 'string' ? value.toLowerCase() : ''
}

/**
 * Handle one HTTP request against the browser API.
 *
 * @param ctx host context.
 * @param req incoming request.
 * @param res response.
 * @param options trusted hosts and environment override.
 */
export async function handleApiRequest (
  ctx: unknown,
  req: IncomingMessage,
  res: ServerResponse,
  options: HandlerOptions = {},
): Promise<void> {
  try {
    if (!isTrustedApiRequest(req, options.trustedHosts || [])) {
      writeError(res, 403, 'forbidden', 'Forbidden')

      return
    }

    // The DSH connection service is the authority whenever it is available:
    // it applies the Host/Origin fence and then requires a browser session or
    // an API credential for every request, loopback included. Skipping it for
    // a "loopback" Host would be a hole, because the Host header is supplied
    // by the client: a remote caller could send `Host: 127.0.0.1` and reach
    // every action unauthenticated. Only a profile without the service
    // (headless) falls back to loopback as the local trust boundary.
    if (resolveConnection(ctx) !== undefined || !isLoopbackRequest(req)) {
      const rejection = sessionRejection(ctx, req)

      if (rejection !== undefined) {
        writeError(
          res,
          rejection,
          rejection === 401 ? 'authentication-required' : 'forbidden',
          rejection === 401
            ? 'Authentication required: open the DSH Web UI from its printed URL.'
            : 'Untrusted request',
        )

        return
      }
    }

    if (req.method !== 'POST') {
      writeError(res, 405, 'method-error', 'Method not allowed')

      return
    }

    if (!contentTypeOf(req).startsWith('application/json')) {
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
    // eslint-disable-next-line no-console
    console.error('[dsh-groq-speech] API error:', safeErrorMessage(error instanceof Error ? error.message : undefined))
    writeError(res, 500, 'internal', 'Internal error')
  }
}

/**
 * Build the `webServer` prefix handler.
 *
 * @param ctx host context.
 * @param options trusted hosts and environment override.
 * @returns a prefix-route handler.
 */
export function createApiHandler (ctx: unknown, options: HandlerOptions = {}): ApiHandler {
  return (req, res) => handleApiRequest(ctx, req, res, options)
}
