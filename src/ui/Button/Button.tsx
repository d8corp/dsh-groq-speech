import type * as ReactTypes from 'react'

import { getReact } from '../../utils'

export interface ButtonProps {
  children: ReactTypes.ReactNode
  variant?: 'primary' | 'secondary'
  compact?: boolean
  disabled?: boolean
  onClick?: () => void
}

/**
 * Settings-section button.
 *
 * @param props label, variant and click handler.
 * @returns the button element.
 */
export function Button ({ children, variant = 'primary', compact, disabled, onClick }: ButtonProps) {
  const React = getReact()
  const classes = ['gqs-button', 'gqs-' + variant]

  if (compact) classes.push('gqs-compact')

  return React.createElement(
    'button',
    {
      type: 'button',
      className: classes.join(' '),
      disabled,
      onClick,
    },
    children,
  )
}
