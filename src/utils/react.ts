import type * as ReactTypes from 'react'

let react: typeof ReactTypes

/**
 * The shell's React instance, injected by the ModuleLoader factory.
 *
 * @returns the React module shared with the host page.
 */
export function getReact (): typeof ReactTypes {
  return react
}

/**
 * Install the shell's React instance.
 *
 * @param value the module resolved from `require('react')`.
 */
export function setReact (value: typeof ReactTypes): void {
  react = value
}
