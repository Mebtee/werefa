import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

type Tone = 'info' | 'success' | 'warning' | 'danger'

interface AlertProps {
  tone?: Tone
  title?: string
  /** Assertive alerts are read out immediately; polite ones queue politely. */
  live?: 'assertive' | 'polite'
  children: ReactNode
  className?: string
}

export function Alert({
  tone = 'info',
  title,
  live,
  children,
  className,
}: AlertProps) {
  const role = tone === 'danger' || tone === 'warning' ? 'alert' : 'status'
  return (
    <div
      className={cn('alert', `alert--${tone}`, className)}
      role={role}
      aria-live={live ?? (role === 'alert' ? 'assertive' : 'polite')}
    >
      <div>
        {title && <div className="alert__title">{title}</div>}
        <div>{children}</div>
      </div>
    </div>
  )
}