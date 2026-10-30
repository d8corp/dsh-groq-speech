/**
 * Environment helpers for the offline test suite.
 *
 * Every suite that touches settings runs inside its own temporary `DSH_HOME`,
 * so the developer's real `~/.dsh` is never read or written. The previous
 * environment value is always restored, even when a test throws.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * @returns an existing, empty temporary directory.
 */
export function makeTempHome (): string {
  return mkdtempSync(join(tmpdir(), 'dsh-groq-speech-test-'))
}

/**
 * Run `fn(dir)` with `DSH_HOME` pointing at a fresh temporary directory.
 *
 * @param fn test body.
 * @returns the body result.
 */
export async function withTempHome<T> (fn: (dir: string) => T | Promise<T>): Promise<T> {
  const dir = makeTempHome()
  const hadHome = Object.prototype.hasOwnProperty.call(process.env, 'DSH_HOME')
  const previous = process.env.DSH_HOME

  process.env.DSH_HOME = dir

  try {
    return await fn(dir)
  } finally {
    if (hadHome) process.env.DSH_HOME = previous
    else delete process.env.DSH_HOME

    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * Run `fn()` with temporary environment overrides.
 *
 * @param overrides values to install; `undefined` deletes the variable.
 * @param fn test body.
 * @returns the body result.
 */
export async function withEnv<T> (
  overrides: Record<string, string | undefined>,
  fn: () => T | Promise<T>,
): Promise<T> {
  const saved = new Map<string, string | undefined>()

  for (const [key, value] of Object.entries(overrides)) {
    saved.set(key, Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : undefined)

    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }

  try {
    return await fn()
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}
