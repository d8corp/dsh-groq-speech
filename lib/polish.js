/**
 * Optional LLM polish pass for a transcript.
 *
 * Polish runs through DSH's configured model routes (`ctx.llm`), including the
 * agent's own Groq provider when one is configured. Every failure — missing
 * route, timeout, stream error, even an import failure in a bare Node test —
 * returns the raw transcript unchanged: the user's words are never lost.
 */

import {
  DEFAULT_POLISH_PROMPT,
  POLISH_TIMEOUT_MS
} from './constants.js'

/**
 * Resolve the polish system prompt from settings.
 * A non-empty custom prompt wins; blank falls back to the built-in default.
 * @param {unknown} settings
 * @returns {string}
 */
export function resolvePolishPrompt (settings) {
  const polish = settings !== null && typeof settings === 'object' ? settings.polish : undefined
  const custom = polish !== null && typeof polish === 'object' && typeof polish.prompt === 'string'
    ? polish.prompt.trim()
    : ''
  return custom !== '' ? custom : DEFAULT_POLISH_PROMPT
}

/**
 * Polish one transcript through DSH's configured LLM.
 * @param {object} options
 * @param {object} options.ctx - host context carrying `llm`.
 * @param {string} options.text - raw transcript.
 * @param {string} options.provider - DSH LLM provider route.
 * @param {string} options.model - model id on that route.
 * @param {string} [options.prompt] - custom system prompt; empty = default.
 * @param {AbortSignal} [options.signal] - caller cancellation.
 * @param {number} [options.timeoutMs]
 * @returns {Promise<string>} polished text, or the raw text on any failure.
 */
export async function polishTranscript ({
  ctx,
  text,
  provider,
  model,
  prompt,
  signal,
  timeoutMs = POLISH_TIMEOUT_MS
} = {}) {
  const raw = typeof text === 'string' ? text : ''
  if (raw.trim() === '') return raw
  if (typeof provider !== 'string' || provider === '') return raw
  if (typeof model !== 'string' || model === '') return raw

  const system = typeof prompt === 'string' && prompt.trim() !== ''
    ? prompt.trim()
    : DEFAULT_POLISH_PROMPT

  if (ctx === null || typeof ctx !== 'object' || ctx.llm === null || typeof ctx.llm !== 'object') return raw
  if (typeof ctx.llm.prepareCall !== 'function') return raw

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const forward = () => controller.abort(signal && signal.reason)
  if (signal) {
    signal.addEventListener('abort', forward, { once: true })
    if (signal.aborted) forward()
  }

  try {
    const prepared = await ctx.llm.prepareCall({ provider, model }, controller.signal)
    // Lazy import: DSH provides @deepseek-ai/dsh-llm at runtime, but host files
    // must stay importable in plain Node for the offline tests. This runs only
    // on the first real polish call and is cached by Node afterwards.
    const { createUserMessage } = await import('@deepseek-ai/dsh-llm')
    const message = createUserMessage({
      content: [{ type: 'text', text: raw }],
      source: { kind: 'user' }
    })

    let output = ''
    for await (const chunk of prepared.stream({
      provider,
      model,
      ...prepared.config,
      messages: [message],
      system,
      signal: controller.signal
    })) {
      if (chunk === null || typeof chunk !== 'object') continue
      if (chunk.type === 'text-delta' && typeof chunk.text === 'string') {
        output += chunk.text
      } else if (chunk.type === 'finish' && chunk.reason &&
        (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted')) {
        throw new Error('Polish call failed')
      }
    }

    const polished = output.trim()
    return polished === '' ? raw : polished
  } catch {
    // Any polish failure keeps the raw transcript (never surface a partial one).
    return raw
  } finally {
    clearTimeout(timer)
    if (signal) signal.removeEventListener('abort', forward)
  }
}
