/**
 * dsh-groq-speech — host plugin entry.
 *
 * Registers a Groq Whisper `SpeechProvider` with the experimental voice-input
 * registry, the same-origin settings API used by the browser half, and the
 * post-uninstall data cleanup watcher. Neither registration throws when the
 * user has no key: a missing key is a normal state surfaced in the settings
 * page and as a transcription error.
 */

import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { ApiHandler } from './api'
import { createApiHandler } from './api'
import { API_PREFIX } from './constants'
import { buildTrustedHosts } from './fence'
import type { SpeechProvider } from './provider'
import { createProvider } from './provider'
import {
  cancelUninstallCleanup,
  profileDeclaresPackage,
  watchForUninstallCleanup,
} from './uninstall'

interface PluginContext {
  baseUrl?: unknown
  webStartup?: {
    trustedHosts?: unknown
  }
  webServer: {
    register (route: { kind: 'prefix', path: string, handler: ApiHandler }): unknown
  }
  speechToText: {
    register (provider: SpeechProvider): unknown
  }
  effect (callback: () => unknown, label: string): unknown
}

/**
 * Resolve the profile directory from the loader context. The loader sets
 * `baseUrl` to the directory of the profile configuration, which is also the
 * directory holding `package.json`.
 *
 * @param baseUrl context base URL, usually a `file:` URL.
 * @returns an absolute directory path, or null when it cannot be resolved.
 */
function resolveProfileDir (baseUrl: unknown): string | null {
  if (typeof baseUrl !== 'string' || baseUrl.trim() === '') return null

  try {
    const value = baseUrl.startsWith('file:')
      ? fileURLToPath(new URL('.', baseUrl))
      : baseUrl

    return resolve(value)
  } catch {
    return null
  }
}

/** Plugin identity used by the composed profile. */
export const name = 'groq-speech'

/** Services required before mounting. */
export const inject = ['speechToText', 'webServer', 'webStartup', 'credentials', 'llm']

/**
 * Mount the provider, the browser API and the uninstall watcher.
 *
 * @param ctx host context.
 */
export function apply (ctx: PluginContext): void {
  // A new instance means any watcher from the previous one is moot.
  cancelUninstallCleanup()

  const provider = createProvider(ctx)

  ctx.effect(() => {
    const dispose = ctx.speechToText.register(provider)

    return dispose
  }, 'dsh-groq-speech: provider')

  // Validate trusted hosts once: a bad user-configured entry must not throw
  // inside every request handler.
  const trustedHosts = buildTrustedHosts(ctx.webStartup?.trustedHosts, (message) => {
    // eslint-disable-next-line no-console
    console.warn('[dsh-groq-speech] ignoring invalid trusted host:', message)
  })

  const handler = createApiHandler(ctx, { trustedHosts })

  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: API_PREFIX,
    handler,
  }), 'dsh-groq-speech: api')

  const profileDir = resolveProfileDir(ctx.baseUrl)

  // Watch only a manifest that currently declares this package: a context
  // rooted elsewhere says nothing about our lifecycle and must never trigger
  // deletion of plugin data.
  if (profileDir !== null && profileDeclaresPackage(profileDir) === true) {
    const watchedProfileDir = profileDir

    ctx.effect(() => () => {
      watchForUninstallCleanup({ profileDir: watchedProfileDir })
    }, 'dsh-groq-speech: uninstall cleanup')
  }
}
