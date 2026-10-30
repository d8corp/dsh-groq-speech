export interface StatusProps {
  /** `on` is the healthy/configured state, `off` the missing one. */
  state: 'on' | 'off'
  label: string
  hint?: string
}

/**
 * Visible status pill with a dot; reports presence only, never key material.
 *
 * @param props pill state, text and optional tooltip.
 * @returns the badge element.
 */
export function Status ({ state, label, hint }: StatusProps) {
  return (
    <span
      className={`gqs-badge gqs-badge-${state}`}
      title={hint}
      aria-label={label}
    >
      <span className='gqs-dot' aria-hidden='true' />
      {label}
    </span>
  )
}
