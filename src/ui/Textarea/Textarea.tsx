import { getReact } from '../../utils'

export interface TextareaProps {
  id?: string
  value: string
  placeholder?: string
  rows?: number
  maxLength?: number
  disabled?: boolean
  onChange: (value: string) => void
}

/**
 * Multi-line editor used by the polish prompt row.
 *
 * @param props value, placeholder and change handler.
 * @returns the textarea element.
 */
export function Textarea ({ id, value, placeholder, rows = 4, maxLength, disabled, onChange }: TextareaProps) {
  const React = getReact()

  return React.createElement('textarea', {
    id,
    className: 'gqs-textarea',
    value,
    placeholder,
    rows,
    maxLength,
    disabled,
    spellCheck: true,
    onChange: (event: { target: { value: string } }) => onChange(event.target.value),
  })
}
