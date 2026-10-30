import type * as ReactTypes from 'react'

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
  const titleNode = htmlFor
    ? <label className='gqs-title' htmlFor={htmlFor} children={title} />
    : <span className='gqs-title' children={title} />

  return (
    <div className={prompt ? 'gqs-row gqs-row-prompt' : 'gqs-row'}>
      <div className='gqs-text'>
        <div className='gqs-titleRow'>
          {titleNode}
          {badge || null}
        </div>
        {description ? <div className='gqs-desc' children={description} /> : null}
      </div>
      {prompt ? control : <div className='gqs-control' children={control} />}
    </div>
  )
}
