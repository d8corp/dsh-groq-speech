/**
 * Read the official voice-input selection and switch it to Groq Whisper.
 *
 * The official bundle owns the selection (persisted per profile), so this
 * module only reports it and offers one explicit action. Every read is
 * best-effort: a profile without the voice-input bundle reports
 * `available: false` instead of failing the settings page.
 */

import { PROVIDER_ID } from './constants'
import type { VoiceInputStatus } from './contracts'

interface SpeechServiceLike {
  snapshot?: () => unknown
  configure?: (patch: { providerId: string }) => unknown
}

interface SpeechSnapshot {
  providers?: unknown
  selection?: unknown
}

interface VoiceProvider {
  id: string
  name: string
}

function isPlainObject (value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function resolveSpeechService (ctx: unknown): SpeechServiceLike | undefined {
  if (ctx === null || typeof ctx !== 'object') return undefined

  let service: unknown

  try {
    service = (ctx as { speechToText?: unknown }).speechToText
  } catch {
    return undefined
  }

  return service !== null && typeof service === 'object' ? service as SpeechServiceLike : undefined
}

/**
 * Read one detached snapshot; undefined when the service is absent or throws.
 *
 * @param ctx host context.
 * @returns the snapshot, or undefined.
 */
function readSnapshot (ctx: unknown): SpeechSnapshot | undefined {
  const service = resolveSpeechService(ctx)

  if (service === undefined || typeof service.snapshot !== 'function') return undefined

  try {
    const snapshot = service.snapshot()

    return isPlainObject(snapshot) ? snapshot : undefined
  } catch {
    return undefined
  }
}

/**
 * Normalize the provider catalogue to the id/name pairs this plugin needs.
 *
 * @param snapshot official snapshot.
 * @returns the providers, in registration order.
 */
function readProviders (snapshot: SpeechSnapshot): VoiceProvider[] {
  const providers: VoiceProvider[] = []

  for (const entry of Array.isArray(snapshot.providers) ? snapshot.providers : []) {
    if (!isPlainObject(entry) || typeof entry.id !== 'string' || entry.id === '') continue

    providers.push({
      id: entry.id,
      name: typeof entry.name === 'string' && entry.name !== '' ? entry.name : entry.id,
    })
  }

  return providers
}

/**
 * Describe the current voice-input provider selection.
 *
 * @param ctx host context.
 * @returns the selection; `available` is false when it cannot be read.
 */
export function readVoiceInputStatus (ctx: unknown): VoiceInputStatus {
  const snapshot = readSnapshot(ctx)

  if (snapshot === undefined) {
    return {
      available: false,
      selectable: false,
      providerId: null,
      providerName: null,
      selected: false,
    }
  }

  const providers = readProviders(snapshot)
  const selection = isPlainObject(snapshot.selection) ? snapshot.selection : {}

  const providerId = typeof selection.providerId === 'string' && selection.providerId !== ''
    ? selection.providerId
    : null

  const selectedProvider = providerId === null
    ? undefined
    : providers.find((provider) => provider.id === providerId)

  const service = resolveSpeechService(ctx)

  return {
    available: true,
    selectable: providers.some((provider) => provider.id === PROVIDER_ID) &&
      typeof service?.configure === 'function',
    providerId,
    providerName: selectedProvider !== undefined ? selectedProvider.name : providerId,
    selected: providerId === PROVIDER_ID,
  }
}

/**
 * Check whether the official service is ready to switch to Groq Whisper.
 *
 * @param ctx host context.
 * @returns true when the provider is registered and configure is callable.
 */
export function canSelectVoiceProvider (ctx: unknown): boolean {
  return readVoiceInputStatus(ctx).selectable
}

/**
 * Make Groq Whisper the selected voice-input provider.
 *
 * @param ctx host context.
 * @returns the selection after the official service applied the change.
 */
export async function selectGroqProvider (ctx: unknown): Promise<VoiceInputStatus> {
  const service = resolveSpeechService(ctx)

  if (service === undefined || typeof service.configure !== 'function') {
    throw new Error('Voice input does not support selection')
  }

  await service.configure({ providerId: PROVIDER_ID })

  return readVoiceInputStatus(ctx)
}
