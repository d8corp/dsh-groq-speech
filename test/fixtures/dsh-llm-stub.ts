/**
 * Minimal stand-in for `@deepseek-ai/dsh-llm` in the offline suite.
 *
 * Only `createUserMessage` is used by the polish pass. The real package is a
 * peer dependency of the installed DSH profile, not of this checkout, so the
 * Jest module mapper points this specifier at this file.
 */

/**
 * Build the user message passed to the polish model.
 *
 * @param input message content and source.
 * @returns a message-shaped object.
 */
export function createUserMessage (
  input: { content?: unknown, source?: unknown } = {},
): { role: 'user', content: unknown, source: unknown } {
  return { role: 'user', content: input.content, source: input.source }
}
