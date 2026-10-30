import type * as ReactTypes from 'react'

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
  const classes = ['gqs-button', 'gqs-' + variant]

  if (compact) classes.push('gqs-compact')

  return <button type='button' className={classes.join(' ')} disabled={disabled} onClick={onClick} children={children} />
}
