/**
 * Optional LLM polish pass for a transcript.
 *
 * Polish runs through DSH's configured model routes (`ctx.llm`), including the
 * agent's own Groq provider when one is configured. Every failure — missing
 * route, timeout, stream error, even an import failure in a bare Node test —
 * returns the raw transcript unchanged: the user's words are never lost.
 */

import { DEFAULT_POLISH_PROMPT, POLISH_TIMEOUT_MS } from './constants'

/** Module id resolved lazily so host files load without DSH installed. */
const DSH_LLM_MODULE = '@deepseek-ai/dsh-llm'

interface StreamChunk {
  type?: unknown
  text?: unknown
  reason?: { kind?: unknown }
}

interface PreparedCall {
  config?: Record<string, unknown>
  stream (options: Record<string, unknown>): AsyncIterable<unknown>
}

interface LlmLike {
  prepareCall (route: { provider: string, model: string }, signal: AbortSignal): Promise<PreparedCall>
}

/**
 * Resolve the polish system prompt from settings.
 *
 * A non-empty custom prompt wins; blank falls back to the built-in default.
 *
 * @param settings settings document (or anything settings-shaped).
 * @returns the system prompt.
 */
export function resolvePolishPrompt (settings: unknown): string {
  const polish = settings !== null && typeof settings === 'object'
    ? (settings as { polish?: unknown }).polish
    : undefined

  const custom = polish !== null && typeof polish === 'object' && typeof (polish as { prompt?: unknown }).prompt === 'string'
    ? (polish as { prompt: string }).prompt.trim()
    : ''

  return custom !== '' ? custom : DEFAULT_POLISH_PROMPT
}

/**
 * Read the LLM service from a host context without assuming its full shape.
 *
 * @param ctx host context.
 * @returns the service when it exposes `prepareCall`.
 */
function resolveLlm (ctx: unknown): LlmLike | undefined {
  if (ctx === null || typeof ctx !== 'object') return undefined

  const llm = (ctx as { llm?: unknown }).llm

  if (llm === null || typeof llm !== 'object') return undefined

  return typeof (llm as LlmLike).prepareCall === 'function' ? llm as LlmLike : undefined
}

export interface PolishOptions {
  /** Host context carrying `llm`. */
  ctx?: unknown
  /** Raw transcript. */
  text?: unknown
  /** DSH LLM provider route. */
  provider?: unknown
  /** Model id on that route. */
  model?: unknown
  /** Custom system prompt; empty uses the default. */
  prompt?: unknown
  /** Caller cancellation. */
  signal?: AbortSignal
  /** Per-call deadline. */
  timeoutMs?: number
}

/**
 * Polish one transcript through DSH's configured LLM.
 *
 * @param options transcript, route, prompt and cancellation controls.
 * @returns polished text, or the raw text on any failure.
 */
export async function polishTranscript (options: PolishOptions = {}): Promise<string> {
  const {
    ctx,
    text,
    provider,
    model,
    prompt,
    signal,
    timeoutMs = POLISH_TIMEOUT_MS,
  } = options

  const raw = typeof text === 'string' ? text : ''

  if (raw.trim() === '') return raw
  if (typeof provider !== 'string' || provider === '') return raw
  if (typeof model !== 'string' || model === '') return raw

  const llm = resolveLlm(ctx)

  if (llm === undefined) return raw

  const system = typeof prompt === 'string' && prompt.trim() !== ''
    ? prompt.trim()
    : DEFAULT_POLISH_PROMPT

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const forward = (): void => controller.abort(signal && signal.reason)

  if (signal) {
    signal.addEventListener('abort', forward, { once: true })

    if (signal.aborted) forward()
  }

  try {
    const prepared = await llm.prepareCall({ provider, model }, controller.signal)

    // Lazy import: DSH provides @deepseek-ai/dsh-llm at runtime, but host files
    // must stay importable in plain Node for the offline tests. This runs only
    // on the first real polish call and is cached by Node afterwards.
    const { createUserMessage } = await import(DSH_LLM_MODULE) as {
      createUserMessage: (input: unknown) => unknown
    }

    const message = createUserMessage({
      content: [{ type: 'text', text: raw }],
      source: { kind: 'user' },
    })

    let output = ''

    for await (const chunk of prepared.stream({
      provider,
      model,
      ...(prepared.config ?? {}),
      messages: [message],
      system,
      signal: controller.signal,
    })) {
      if (chunk === null || typeof chunk !== 'object') continue

      const value = chunk as StreamChunk

      if (value.type === 'text-delta' && typeof value.text === 'string') {
        output += value.text
      } else if (value.type === 'finish' && value.reason &&
        (value.reason.kind === 'error' || value.reason.kind === 'aborted')) {
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
