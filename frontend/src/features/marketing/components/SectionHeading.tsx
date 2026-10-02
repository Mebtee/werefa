import type { ReactNode } from 'react'

interface SectionHeadingProps {
  eyebrow?: string
  title: ReactNode
  lead?: ReactNode
  id?: string
  align?: 'start' | 'center'
}

/** Shared section heading: eyebrow + h2 + optional lead paragraph. */
export function SectionHeading({
  eyebrow,
  title,
  lead,
  id,
  align = 'start',
}: SectionHeadingProps) {
  return (
    <div className={`mkt-heading mkt-heading--${align}`}>
      {eyebrow ? <p className="mkt-eyebrow">{eyebrow}</p> : null}
      <h2 className="mkt-heading__title" id={id}>
        {title}
      </h2>
      {lead ? <p className="mkt-heading__lead">{lead}</p> : null}
    </div>
  )
}
