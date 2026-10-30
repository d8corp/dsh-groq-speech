/**
 * Same-origin request fence and small JSON HTTP helpers.
 *
 * The browser API is reachable from any page that can talk to the DSH Web
 * server, so every request must come from loopback or an explicitly trusted
 * host, must not be a cross-site fetch, and — when the browser sends an Origin
 * header — must target the same origin it came from. Pure Node helpers only:
 * this module is importable in plain Node for the offline test suite.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'

import { MAX_BODY_BYTES } from './constants'

/** Sentinel resolved by {@link readJsonBody} when the body exceeds the cap. */
export const PAYLOAD_TOO_LARGE = Symbol('payload-too-large')

/**
 * Parse a bare `host[:port]` authority into a URL.
 *
 * @param authority header value or configured entry.
 * @returns parsed URL, or undefined when the value is not a bare authority.
 */
export function parseAuthority (authority: unknown): URL | undefined {
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
 *
 * @param hostname URL hostname, with or without IPv6 brackets.
 * @returns true for `localhost`, `::1` and `127.0.0.0/8`.
 */
export function isLoopbackHostname (hostname: unknown): boolean {
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
 *
 * @param authority bare `host[:port]`.
 * @returns the canonical form, or undefined for a malformed authority.
 */
export function canonicalAuthority (authority: string): string | undefined {
  const url = parseAuthority(authority)

  if (url === undefined) return undefined

  const explicitPort = /:(\d+)$/.exec(authority.trim())

  return explicitPort === null ? url.hostname : `${url.hostname}:${explicitPort[1]}`
}

function isTrustedAuthority (authority: string, hostUrl: URL, trustedHosts: string[]): boolean {
  const requestAuthority = canonicalAuthority(authority) || hostUrl.hostname

  return trustedHosts.some((entry) => {
    const url = parseAuthority(entry)

    if (url === undefined) return false

    const canonical = canonicalFrom(url, entry)

    return canonical !== url.hostname ? canonical === requestAuthority : url.hostname === hostUrl.hostname
  })
}

function canonicalFrom (url: URL, authority: string): string {
  const explicitPort = /:(\d+)$/.exec(authority.trim())

  return explicitPort === null ? url.hostname : `${url.hostname}:${explicitPort[1]}`
}

/**
 * Validate and filter `webStartup.trustedHosts` once, at plugin startup.
 *
 * A malformed user-configured entry must not throw inside every request
 * handler; it is reported through `warn` and ignored instead.
 *
 * @param entries configured trusted host authorities.
 * @param warn diagnostic sink.
 * @returns usable authorities.
 */
export function buildTrustedHosts (entries: unknown, warn?: (message: string) => void): string[] {
  const trusted: string[] = []

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

function headersOf (req: unknown): Record<string, unknown> {
  return req !== null && typeof req === 'object' && 'headers' in req && req.headers !== null && typeof req.headers === 'object'
    ? req.headers as Record<string, unknown>
    : {}
}

/**
 * Decide whether a request may use the browser API.
 *
 * Requirements: a parseable Host header on loopback or a trusted authority,
 * no `sec-fetch-site: cross-site`, and — when Origin is present — an Origin
 * whose host (including port) equals the Host header.
 *
 * @param req incoming request.
 * @param trustedHosts configured non-loopback authorities.
 * @returns true when the Host/Origin fence admits the request.
 */
export function isTrustedApiRequest (req: unknown, trustedHosts: string[] = []): boolean {
  if (req === null || typeof req !== 'object') return false

  const headers = headersOf(req)
  const host = typeof headers.host === 'string' ? headers.host : undefined

  if (host === undefined) return false

  const hostUrl = parseAuthority(host)

  if (hostUrl === undefined) return false
  if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(host, hostUrl, trustedHosts)) return false

  const site = headers['sec-fetch-site']

  if (typeof site === 'string' && site.toLowerCase() === 'cross-site') return false

  const origin = headers.origin

  if (origin === undefined || origin === '') return true
  if (typeof origin !== 'string') return false

  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

/**
 * Whether a request targets a loopback authority.
 *
 * @param req incoming request carrying a Host header.
 * @returns true for localhost, ::1 and 127.0.0.0/8 authorities.
 */
export function isLoopbackRequest (req: unknown): boolean {
  const headers = headersOf(req)
  const host = typeof headers.host === 'string' ? headers.host : undefined

  if (host === undefined) return false

  const authority = parseAuthority(host)

  return authority !== undefined && isLoopbackHostname(authority.hostname)
}

/**
 * Read and JSON-parse a request body with a hard size cap.
 *
 * Overflow resolves with {@link PAYLOAD_TOO_LARGE} instead of rejecting, so the
 * caller can answer 413 while the socket is still writable.
 *
 * @param req incoming request.
 * @param maxBytes hard body cap.
 * @returns the parsed body, null for empty/invalid JSON, or the sentinel.
 */
export function readJsonBody (req: IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<unknown | typeof PAYLOAD_TOO_LARGE> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
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
 *
 * @param res response.
 * @param status HTTP status.
 * @param value JSON-serializable body.
 */
export function writeJson (res: ServerResponse, status: number, value: unknown): void {
  if (!res || res.writableEnded || res.destroyed) return

  const body = JSON.stringify(value)

  res.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
  })

  res.end(body)
}

/**
 * Write one `{ ok: false, error: { code, message } }` response.
 *
 * @param res response.
 * @param status HTTP status.
 * @param code stable machine code.
 * @param message fixed user-facing message.
 */
export function writeError (res: ServerResponse, status: number, code: string, message: string): void {
  writeJson(res, status, { ok: false, error: { code, message } })
}

/**
 * Sanitize an unexpected error message for the log: one line, bounded length.
 * Never pass a secret into this helper.
 *
 * @param value raw value.
 * @returns a safe single-line message.
 */
export function safeErrorMessage (value: unknown): string {
  if (typeof value !== 'string') return 'unknown error'

  const line = value.replace(/[\r\n\t]+/g, ' ').trim()

  return line.length > 500 ? `${line.slice(0, 500)}…` : line
}
