/**
 * Hand-written fake host contexts. No DSH package is imported or booted.
 *
 * The fakes mirror the documented subset of each service that the plugin
 * uses, and record every call so tests can assert on side effects without
 * reaching into private internals.
 */

import type { SpeechProvider } from '../../src/provider'

/** One registered web route. */
export interface FakeRoute {
  kind: 'prefix'
  path: string
  handler: (req: unknown, res: unknown) => unknown
}

/** A stored credential value captured by the fake service. */
export interface FakeStored {
  value: string
}

/** Every service call the fake context recorded. */
export interface FakeCalls {
  resolve: unknown[]
  describe: unknown[]
  set: Array<{ ref: unknown, value: string }>
  unset: unknown[]
  providers: SpeechProvider[]
  routes: FakeRoute[]
  warnings: string[]
}

export interface FakeCtxOptions {
  /** A stored credential value. */
  key?: string
  /** Value the credentials service resolves from the environment. */
  envKey?: string
  /** Set to `false` to omit the credentials service. */
  credentials?: boolean
  /** Override the LLM service. */
  llm?: unknown
  /** `webStartup.trustedHosts`. */
  trustedHosts?: string[]
  /** Set to `false` to skip executing effect bodies. */
  effect?: boolean
}

export interface FakeCtx {
  ctx: Record<string, any>
  calls: FakeCalls
  effects: string[]
  stored: FakeStored
}

/**
 * Create a fake `ctx` with credentials, llm, speechToText, webServer,
 * webStartup and effect services.
 *
 * @param options service overrides.
 * @returns the context plus its recorded calls.
 */
export function createFakeCtx (options: FakeCtxOptions = {}): FakeCtx {
  const stored: FakeStored = { value: typeof options.key === 'string' ? options.key : '' }
  const effects: string[] = []
  const calls: FakeCalls = {
    resolve: [],
    describe: [],
    set: [],
    unset: [],
    providers: [],
    routes: [],
    warnings: [],
  }

  const credentials = options.credentials === false
    ? undefined
    : {
        async resolve (ref: unknown) {
          calls.resolve.push(ref)

          if (stored.value !== '') return { value: stored.value, source: 'file' }
          if (typeof options.envKey === 'string' && options.envKey !== '') {
            return { value: options.envKey, source: 'env' }
          }

          return null
        },
        async describe (ref: unknown) {
          calls.describe.push(ref)

          if (stored.value !== '') return { configured: true, source: 'file', writable: true }
          if (typeof options.envKey === 'string' && options.envKey !== '') {
            return { configured: true, source: 'env', writable: false }
          }

          return { configured: false, source: null, writable: true }
        },
        async set (ref: unknown, value: string) {
          calls.set.push({ ref, value })
          stored.value = value
        },
        async unset (ref: unknown) {
          calls.unset.push(ref)
          stored.value = ''
        },
      }

  const llm = options.llm === undefined
    ? {
        listProviders: () => [],
        listModels: () => [],
      }
    : options.llm

  const speechToText = {
    register (provider: SpeechProvider) {
      calls.providers.push(provider)

      return () => {
        calls.providers.splice(calls.providers.indexOf(provider), 1)
      }
    },
  }

  const webServer = {
    register (route: FakeRoute) {
      calls.routes.push(route)

      return () => {
        calls.routes.splice(calls.routes.indexOf(route), 1)
      }
    },
  }

  const ctx: Record<string, any> = {
    credentials,
    llm,
    speechToText,
    webServer,
    webStartup: {
      trustedHosts: Array.isArray(options.trustedHosts) ? options.trustedHosts : [],
    },
    effect (setup: () => unknown, label: string) {
      effects.push(label)

      if (options.effect === false) return () => {}

      const dispose = setup()

      return () => {
        if (typeof dispose === 'function') (dispose as () => void)()
      }
    },
  }

  return { ctx, calls, effects, stored }
}
