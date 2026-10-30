import type { ModelRoute } from '../contracts'

/** Provider/model select value separator (never user-visible). */
export const MODEL_VALUE_SEPARATOR = '\u0000'

/**
 * Normalize the `list-models` value into usable rows.
 *
 * @param value raw host response.
 * @returns only routes with both a provider and a model id.
 */
export function normalizeModels (value: unknown): ModelRoute[] {
  const rows: ModelRoute[] = []

  for (const item of Array.isArray(value) ? value : []) {
    if (item === null || typeof item !== 'object') continue

    const record = item as Record<string, unknown>
    const provider = typeof record.provider === 'string' ? record.provider : ''
    const model = typeof record.model === 'string' ? record.model : ''

    if (!provider || !model) continue

    rows.push({
      provider,
      providerName: typeof record.providerName === 'string' && record.providerName ? record.providerName : provider,
      model,
      modelName: typeof record.modelName === 'string' && record.modelName ? record.modelName : model,
    })
  }

  return rows
}

/**
 * Encode one provider/model pair into a select value.
 *
 * @param provider DSH LLM provider route.
 * @param model model id on that route.
 * @returns the encoded value, or `''` when either part is missing.
 */
export function encodeModelValue (provider: string, model: string): string {
  if (!provider || !model) return ''

  return provider + MODEL_VALUE_SEPARATOR + model
}

/**
 * Decode a provider/model select value.
 *
 * @param value encoded select value.
 * @returns the provider and model, both `''` when the value is empty.
 */
export function decodeModelValue (value: string): { provider: string, model: string } {
  const text = typeof value === 'string' ? value : ''
  const index = text.indexOf(MODEL_VALUE_SEPARATOR)

  if (index < 0) return { provider: '', model: '' }

  return { provider: text.slice(0, index), model: text.slice(index + 1) }
}

/**
 * Language option label: `auto` is spelled out, codes are uppercase.
 *
 * @param value language hint.
 * @returns the visible label.
 */
export function languageLabel (value: string): string {
  return value === 'auto' ? 'Auto-detect' : String(value).toUpperCase()
}
