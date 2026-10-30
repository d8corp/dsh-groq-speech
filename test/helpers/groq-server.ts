/**
 * A real loopback HTTP server that stands in for the Groq API.
 *
 * Nothing leaves the machine: the suite points the plugin at
 * `GROQ_SPEECH_API_BASE=http://127.0.0.1:<random>/v1`, so the production code
 * path (global fetch, FormData, bearer header) is exercised without a key.
 */

import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'

/** One request captured by the fake Groq server. */
export interface GroqRequest {
  method: string | undefined
  url: string | undefined
  headers: Record<string, string | string[] | undefined>
  body: Buffer
}

export interface GroqServer {
  port: number
  baseUrl: string
  requests: GroqRequest[]
  close: () => Promise<void>
}

export type GroqHandler = (record: GroqRequest, res: ServerResponse) => unknown

/**
 * Start a throwaway server.
 *
 * @param handler request handler; a throw is answered with a JSON 500 so a
 * broken fake never hangs the suite.
 * @returns the server handle and its recorded requests.
 */
export async function startGroqServer (handler: GroqHandler): Promise<GroqServer> {
  const requests: GroqRequest[] = []
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = []

    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('error', () => {})
    req.on('end', () => {
      const body = Buffer.concat(chunks)
      const record: GroqRequest = {
        method: req.method,
        url: req.url,
        headers: req.headers,
        body,
      }

      requests.push(record)

      Promise.resolve()
        .then(() => handler(record, res))
        .catch(() => {
          if (res.headersSent) {
            res.destroy()

            return
          }

          res.writeHead(500, { 'content-type': 'application/json' })
          res.end('{"error":"fake handler failed"}')
        })
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })

  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0

  return {
    port,
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    close () {
      return new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

/**
 * Write one JSON response.
 *
 * @param res response.
 * @param status HTTP status.
 * @param value JSON body.
 */
export function sendJson (res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(value))
}

/** One parsed multipart field. */
export interface MultipartField {
  name: string
  filename: string | undefined
  contentType: string | undefined
  value: string
  bytes: Buffer
}

export interface ParsedMultipart {
  boundary: string
  contentType: string
  fields: MultipartField[]
}

/**
 * Parse a `multipart/form-data` request body into its fields.
 *
 * Only the plain subset that `FormData` emits is supported.
 *
 * @param record captured request.
 * @returns the parsed boundary and fields.
 */
export function parseMultipart (record: GroqRequest): ParsedMultipart {
  const contentType = String(record.headers['content-type'] || '')
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType)

  if (match === null) throw new Error('request is not multipart/form-data')

  const boundary = match[1] || match[2].trim()
  const delimiter = Buffer.from(`--${boundary}`)
  const fields: MultipartField[] = []
  let cursor = record.body.indexOf(delimiter)

  while (cursor >= 0) {
    const start = cursor + delimiter.length

    if (record.body.slice(start, start + 2).toString('utf8') === '--') break

    const next = record.body.indexOf(delimiter, start)

    if (next < 0) break

    let part = record.body.slice(start, next)

    if (part.slice(0, 2).toString('utf8') === '\r\n') part = part.slice(2)
    if (part.slice(-2).toString('utf8') === '\r\n') part = part.slice(0, -2)

    const headerEnd = part.indexOf('\r\n\r\n')
    const headerText = part.slice(0, headerEnd).toString('utf8')
    const bytes = part.slice(headerEnd + 4)
    const nameMatch = /name="([^"]*)"/i.exec(headerText)
    const filenameMatch = /filename="([^"]*)"/i.exec(headerText)
    const typeMatch = /content-type:\s*([^\r\n]+)/i.exec(headerText)

    fields.push({
      name: nameMatch ? nameMatch[1] : '',
      filename: filenameMatch ? filenameMatch[1] : undefined,
      contentType: typeMatch ? typeMatch[1].trim() : undefined,
      value: bytes.toString('utf8'),
      bytes,
    })

    cursor = next
  }

  return { boundary, contentType, fields }
}

/**
 * Build a plausible 16 kHz mono PCM16 WAV-shaped buffer.
 *
 * The plugin never parses the header, so bytes are enough.
 *
 * @param seconds audio duration.
 * @returns the buffer.
 */
export function wavBytes (seconds: number): Buffer {
  return Buffer.alloc(Math.round(seconds * 32000), 0x11)
}
