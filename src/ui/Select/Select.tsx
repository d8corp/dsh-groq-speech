import { getReact } from '../../utils'

export interface SelectOption {
  value: string
  label: string
}

export interface SelectProps {
  id?: string
  value: string
  options: SelectOption[]
  disabled?: boolean
  onChange: (value: string) => void
}

/**
 * Chevron that matches the shell's select controls.
 *
 * @returns the inline SVG element.
 */
function chevron () {
  const React = getReact()

  return React.createElement(
    'svg',
    {
      className: 'gqs-chevron',
      viewBox: '0 0 16 16',
      width: 14,
      height: 14,
      'aria-hidden': 'true',
    },
    React.createElement('path', {
      d: 'M4 6l4 4 4-4',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.5,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    }),
  )
}

/**
 * A select with the shell's 36px module background and chevron.
 *
 * @param props id, value, options and change handler.
 * @returns the wrapped select element.
 */
export function Select ({ id, value, options, disabled, onChange }: SelectProps) {
  const React = getReact()

  return React.createElement(
    'span',
    { className: 'gqs-selectWrap' },
    React.createElement(
      'select',
      {
        id,
        className: 'gqs-select',
        value,
        disabled,
        onChange: (event: { target: { value: string } }) => onChange(event.target.value),
      },
      options.map((option) => React.createElement(
        'option',
        { key: option.value, value: option.value },
        option.label,
      )),
    ),
    chevron(),
  )
}
