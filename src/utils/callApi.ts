import { API_PREFIX } from '../constants'

/**
 * POST one action to the plugin's same-origin route and unwrap the host
 * envelope: `{ ok: true, value }` or `{ ok: false, error: { code, message } }`.
 *
 * Request/response bodies are never logged.
 *
 * @param action action name.
 * @param extra additional body fields.
 * @returns the `value` field of a successful envelope.
 */
export async function callApi (action: string, extra?: Record<string, unknown>): Promise<unknown> {
  const body = Object.assign({ action }, extra || {})

  const response = await fetch(API_PREFIX, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body),
  })

  let payload: unknown = null

  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  const record = payload !== null && typeof payload === 'object' ? payload as Record<string, unknown> : null

  if (record && record.ok === false) {
    const error = record.error as { message?: unknown } | undefined
    const message = error && typeof error.message === 'string' ? error.message : 'Request failed'

    throw new Error(message)
  }

  if (!response.ok) throw new Error('Groq Speech request failed (HTTP ' + response.status + ').')
  if (!record) throw new Error('Groq Speech returned an unreadable response.')

  return Object.prototype.hasOwnProperty.call(record, 'value') ? record.value : record
}
