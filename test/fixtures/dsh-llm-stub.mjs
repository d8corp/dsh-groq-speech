/**
 * Minimal stand-in for `@deepseek-ai/dsh-llm` in the offline suite.
 *
 * Only `createUserMessage` is used by the polish pass. The real package is a
 * peer dependency of the installed DSH profile, not of this checkout, so the
 * polish test installs a resolve hook that points this specifier at this file.
 */

/**
 * @param {{content?: unknown, source?: unknown}} [input]
 * @returns {{role: 'user', content: unknown, source: unknown}}
 */
export function createUserMessage (input = {}) {
  return { role: 'user', content: input.content, source: input.source }
}
