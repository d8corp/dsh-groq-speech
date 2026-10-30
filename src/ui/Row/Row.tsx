import type * as ReactTypes from 'react'

import { getReact } from '../../utils'

export interface RowProps {
  title: string
  description?: string
  control: ReactTypes.ReactNode
  badge?: ReactTypes.ReactNode
  /** Render as a full-width row (used by the prompt editor). */
  prompt?: boolean
  /** Turn the title into a `<label>` bound to the control. */
  htmlFor?: string
}

/**
 * One General-settings-style row: title and description on the left, control
 * on the right.
 *
 * @param props row content.
 * @returns the row element.
 */
export function Row ({ title, description, control, badge, prompt, htmlFor }: RowProps) {
  const React = getReact()

  const titleNode = htmlFor
    ? React.createElement('label', { className: 'gqs-title', htmlFor }, title)
    : React.createElement('span', { className: 'gqs-title' }, title)

  return React.createElement(
    'div',
    { className: prompt ? 'gqs-row gqs-row-prompt' : 'gqs-row' },
    React.createElement(
      'div',
      { className: 'gqs-text' },
      React.createElement('div', { className: 'gqs-titleRow' }, titleNode, badge || null),
      description ? React.createElement('div', { className: 'gqs-desc' }, description) : null,
    ),
    prompt ? control : React.createElement('div', { className: 'gqs-control' }, control),
  )
}
