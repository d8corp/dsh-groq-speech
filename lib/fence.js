/**
 * Same-origin request fence and small JSON HTTP helpers.
 *
 * The browser API is reachable from any page that can talk to the DSH Web
 * server, so every request must come from loopback or an explicitly trusted
 * host, must not be a cross-site fetch, and — when the browser sends an Origin
 * header — must target the same origin it came from. Pure Node helpers only:
 * this module is importable in plain Node for the offline test suite.
 */

import { MAX_BODY_BYTES } from './constants.js'

/** Sentinel resolved by `readJsonBody` when the request body exceeds the cap. */
export const PAYLOAD_TOO_LARGE = Symbol('payload-too-large')

/**
 * Parse a bare `host[:port]` authority into a URL.
 * @param {unknown} authority - header value or configured entry.
 * @returns {URL | undefined} parsed URL, or undefined when the value is not a
 * bare authority (paths, credentials, whitespace, bad brackets).
 */
export function parseAuthority (authority) {
  if (typeof authority !== 'string') return undefined
  const value = authority.trim()
  if (value === '' || /[/?#@\\\s]/.test(value)) return undefined
  try {
    const url = new URL(`http://${value}`)
    if (url.username !== '' || url.password !== '' || url.pathname !== '/') return undefined
    return url
  } catch {
    return undefined
  }
}

/**
 * Whether a hostname names the loopback interface.
 * @param {unknown} hostname - URL hostname, with or without IPv6 brackets.
 * @returns {boolean}
 */
export function isLoopbackHostname (hostname) {
  if (typeof hostname !== 'string' || hostname === '') return false
  let name = hostname.toLowerCase()
  if (name.startsWith('[') && name.endsWith(']')) name = name.slice(1, -1)
  if (name === 'localhost' || name === '::1') return true

  const dotted = name.startsWith('::ffff:') ? name.slice('::ffff:'.length) : name
  const parts = dotted.split('.')
  return parts.length === 4 &&
    parts[0] === '127' &&
    parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

/**
 * Canonical text of an authority: hostname plus an explicitly written port.
 * The default port of the temporary parsing scheme is not treated as explicit.
 * @param {string} authority - bare `host[:port]`.
 * @returns {string | undefined}
 */
export function canonicalAuthority (authority) {
  const url = parseAuthority(authority)
  if (url === undefined) return undefined
  const explicitPort = /:(\d+)$/.exec(authority.trim())
  return explicitPort === null ? url.hostname : `${url.hostname}:${explicitPort[1]}`
}

/** @param {string} authority @param {URL} hostUrl @param {readonly string[]} trustedHosts */
function isTrustedAuthority (authority, hostUrl, trustedHosts) {
  const requestAuthority = canonicalAuthority(authority) || hostUrl.hostname
  return trustedHosts.some((entry) => {
    const url = parseAuthority(entry)
    if (url === undefined) return false
    const canonical = canonicalAuthority(entry)
    if (canonical === undefined) return false
    const entryHasPort = /:\d+$/.test(entry.trim())
    return entryHasPort ? canonical === requestAuthority : url.hostname === hostUrl.hostname
  })
}

/**
 * Validate and filter `webStartup.trustedHosts` once, at plugin startup.
 *
 * A malformed user-configured entry must not throw inside every request
 * handler; it is reported through `warn` and ignored instead.
 * @param {unknown} entries - configured trusted host authorities.
 * @param {(message: string) => void} [warn] - diagnostic sink.
 * @returns {string[]} usable authorities.
 */
export function buildTrustedHosts (entries, warn) {
  const trusted = []
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (typeof entry !== 'string') {
      if (warn) warn('trusted host entry is not a string')
      continue
    }
    const canonical = canonicalAuthority(entry)
    if (canonical === undefined || canonical !== entry.trim().toLowerCase()) {
      if (warn) warn(`entry ${JSON.stringify(entry)} is not a bare host[:port] authority`)
      continue
    }
    trusted.push(entry.trim())
  }
  return trusted
}

/**
 * Decide whether a request may use the browser API.
 *
 * Requirements: a parseable Host header on loopback or a trusted authority,
 * no `sec-fetch-site: cross-site`, and — when Origin is present — an Origin
 * whose host (including port) equals the Host header.
 * @param {import('node:http').IncomingMessage} req
 * @param {readonly string[]} [trustedHosts]
 * @returns {boolean}
 */
export function isTrustedApiRequest (req, trustedHosts = []) {
  if (req === null || typeof req !== 'object') return false
  const headers = req.headers !== null && typeof req.headers === 'object' ? req.headers : {}
  const host = typeof headers.host === 'string' ? headers.host : undefined
  if (host === undefined) return false

  const hostUrl = parseAuthority(host)
  if (hostUrl === undefined) return false
  if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(host, hostUrl, trustedHosts)) return false

  const site = headers['sec-fetch-site']
  if (typeof site === 'string' && site.toLowerCase() === 'cross-site') return false

  const origin = headers.origin
  if (origin === undefined || origin === '') return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

/**
 * Read and JSON-parse a request body with a hard size cap.
 *
 * Overflow resolves with {@link PAYLOAD_TOO_LARGE} instead of rejecting, so the
 * caller can answer 413 while the socket is still writable.
 * @param {import('node:http').IncomingMessage} req
 * @param {number} [maxBytes]
 * @returns {Promise<unknown | typeof PAYLOAD_TOO_LARGE>}
 */
export function readJsonBody (req, maxBytes = MAX_BODY_BYTES) {
  return new Promise((resolve) => {
    const chunks = []
    let size = 0
    let settled = false

    req.on('data', (chunk) => {
      if (settled) return
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8')
      size += buffer.length
      if (size > maxBytes) {
        settled = true
        req.pause()
        resolve(PAYLOAD_TOO_LARGE)
        return
      }
      chunks.push(buffer)
    })

    req.on('end', () => {
      if (settled) return
      settled = true
      try {
        const raw = Buffer.concat(chunks).toString('utf8').trim()
        resolve(raw === '' ? null : JSON.parse(raw))
      } catch {
        resolve(null)
      }
    })

    req.on('error', () => {
      if (settled) return
      settled = true
      resolve(null)
    })
  })
}

/**
 * Write one JSON response. A client that already hung up is ignored rather
 * than producing a write-after-end error.
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} value
 */
export function writeJson (res, status, value) {
  if (!res || res.writableEnded || res.destroyed) return
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store'
  })
  res.end(body)
}

/**
 * Write one `{ ok: false, error: { code, message } }` response.
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {string} code
 * @param {string} message
 */
export function writeError (res, status, code, message) {
  writeJson(res, status, { ok: false, error: { code, message } })
}

/**
 * Sanitize an unexpected error message for the log: one line, bounded length.
 * Never pass a secret into this helper.
 * @param {unknown} value
 * @returns {string}
 */
export function safeErrorMessage (value) {
  if (typeof value !== 'string') return 'unknown error'
  const line = value.replace(/[\r\n\t]+/g, ' ').trim()
  return line.length > 500 ? `${line.slice(0, 500)}…` : line
}
