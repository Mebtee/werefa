import { cn } from '@/lib/cn'

/**
 * Werefa wordmark.
 *
 * The repository ships no official logo asset, so this is a tasteful text
 * treatment built from the existing brand accent (magenta) and typography —
 * not a claim of a registered trademark. The mark is decorative; the visible
 * word "Werefa" carries the accessible name.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('mkt-wordmark', className)}>
      <span className="mkt-wordmark__mark" aria-hidden="true">
        <svg viewBox="0 0 32 32" width="32" height="32" focusable="false">
          <rect width="32" height="32" rx="9" fill="currentColor" />
          <path
            d="M8 10.5 11.4 21l2.6-7 2.6 7L20 10.5"
            fill="none"
            stroke="#fff"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="23.5" cy="13.5" r="1.7" fill="#fff" />
        </svg>
      </span>
      <span className="mkt-wordmark__text">Werefa</span>
    </span>
  )
}
