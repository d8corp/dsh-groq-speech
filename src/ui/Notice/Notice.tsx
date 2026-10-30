import { getReact } from '../../utils'

export interface NoticeProps {
  kind: 'error' | 'success'
  text: string
}

/**
 * Inline success/error notice.
 *
 * @param props severity and message.
 * @returns the notice element.
 */
export function Notice ({ kind, text }: NoticeProps) {
  const React = getReact()

  return React.createElement(
    'p',
    {
      className: 'gqs-notice gqs-notice-' + kind,
      role: kind === 'error' ? 'alert' : 'status',
      'aria-live': 'polite',
      style: { marginTop: '16px' },
    },
    text,
  )
}
