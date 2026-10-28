/**
 * Hand-written fake host contexts. No DSH package is imported or booted.
 *
 * The fakes mirror the documented subset of each service that the plugin
 * uses, and record every call so tests can assert on side effects without
 * reaching into private internals.
 */

/**
 * @typedef {object} FakeCtxOptions
 * @property {string} [key] - a stored credential value.
 * @property {string} [envKey] - value the credentials service resolves from the environment.
 * @property {boolean} [credentials] - set to `false` to omit the credentials service.
 * @property {object} [llm] - override the LLM service.
 * @property {string[]} [trustedHosts] - `webStartup.trustedHosts`.
 * @property {boolean} [effect] - set to `false` to skip executing effect bodies.
 */

/**
 * Create a fake `ctx` with credentials, llm, speechToText, webServer,
 * webStartup and effect services.
 * @param {FakeCtxOptions} [options]
 */
export function createFakeCtx (options = {}) {
  const stored = { value: typeof options.key === 'string' ? options.key : '' }
  /** @type {string[]} */
  const effects = []
  const calls = {
    resolve: [],
    describe: [],
    set: [],
    unset: [],
    providers: [],
    routes: [],
    warnings: []
  }

  const credentials = options.credentials === false
    ? undefined
    : {
        async resolve (ref) {
          calls.resolve.push(ref)
          if (stored.value !== '') return { value: stored.value, source: 'file' }
          if (typeof options.envKey === 'string' && options.envKey !== '') {
            return { value: options.envKey, source: 'env' }
          }
          return null
        },
        async describe (ref) {
          calls.describe.push(ref)
          if (stored.value !== '') return { configured: true, source: 'file', writable: true }
          if (typeof options.envKey === 'string' && options.envKey !== '') {
            return { configured: true, source: 'env', writable: false }
          }
          return { configured: false, source: null, writable: true }
        },
        async set (ref, value) {
          calls.set.push({ ref, value })
          stored.value = value
        },
        async unset (ref) {
          calls.unset.push(ref)
          stored.value = ''
        }
      }

  const llm = options.llm === undefined
    ? {
        listProviders: () => [],
        listModels: () => []
      }
    : options.llm

  const speechToText = {
    register (provider) {
      calls.providers.push(provider)
      return () => {
        calls.providers.splice(calls.providers.indexOf(provider), 1)
      }
    }
  }

  const webServer = {
    register (route) {
      calls.routes.push(route)
      return () => {
        calls.routes.splice(calls.routes.indexOf(route), 1)
      }
    }
  }

  const ctx = {
    credentials,
    llm,
    speechToText,
    webServer,
    webStartup: {
      trustedHosts: Array.isArray(options.trustedHosts) ? options.trustedHosts : []
    },
    effect (setup, label) {
      effects.push(label)
      if (options.effect === false) return () => {}
      const dispose = setup()
      return () => {
        if (typeof dispose === 'function') dispose()
      }
    }
  }

  return { ctx, calls, effects, stored }
}
