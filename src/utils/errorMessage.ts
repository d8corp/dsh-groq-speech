/**
 * Collapse an unknown thrown value into a display-safe single line.
 *
 * @param error thrown value.
 * @param fallback message used when the value carries no text.
 * @returns a non-empty user-facing message.
 */
export function errorMessage (error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim() !== '') return error.message.trim()
  if (typeof error === 'string' && error.trim() !== '') return error.trim()

  return fallback
}
