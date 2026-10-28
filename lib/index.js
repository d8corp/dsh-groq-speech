/**
 * dsh-groq-speech — host plugin entry.
 *
 * Registers a Groq Whisper `SpeechProvider` with the experimental voice-input
 * registry and the same-origin settings API used by the browser half. Neither
 * registration throws when the user has no key: a missing key is a normal
 * state surfaced in the settings page and as a transcription error.
 */

import {
  API_PREFIX
} from './constants.js'
import { createApiHandler } from './api.js'
import { buildTrustedHosts } from './fence.js'
import { createProvider } from './provider.js'

/** Plugin identity used by the composed profile. */
export const name = 'groq-speech'

/** Services required before mounting. */
export const inject = ['speechToText', 'webServer', 'webStartup', 'credentials', 'llm']

/**
 * Mount the provider and the browser API.
 * @param {object} ctx - host context.
 */
export function apply (ctx) {
  const provider = createProvider(ctx)

  ctx.effect(() => {
    const dispose = ctx.speechToText.register(provider)
    return dispose
  }, 'dsh-groq-speech: provider')

  // Validate trusted hosts once: a bad user-configured entry must not throw
  // inside every request handler.
  const trustedHosts = buildTrustedHosts(ctx.webStartup && ctx.webStartup.trustedHosts, (message) => {
    console.warn('[dsh-groq-speech] ignoring invalid trusted host:', message)
  })

  const handler = createApiHandler(ctx, { trustedHosts })
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: API_PREFIX,
    handler
  }), 'dsh-groq-speech: api')
}
