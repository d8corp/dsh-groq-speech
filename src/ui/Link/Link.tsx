import type * as ReactTypes from 'react'

export interface LinkProps {
  href?: string
  onClick?: (event: ReactTypes.MouseEvent<HTMLAnchorElement>) => void
  children: ReactTypes.ReactNode
}

/**
 * Inline text link styled like the shell's settings links.
 *
 * @param props target and click handler.
 * @returns the anchor element.
 */
export function Link ({ href = '#', onClick, children }: LinkProps) {
  return <a children={children} href={href} className='gqs-link' onClick={onClick} />
}
