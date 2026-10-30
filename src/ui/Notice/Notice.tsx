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
  return (
    <p
      className={'gqs-notice gqs-notice-' + kind}
      role={kind === 'error' ? 'alert' : 'status'}
      aria-live='polite'
      style={{ marginTop: '16px' }}
      children={text}
    />
  )
}
