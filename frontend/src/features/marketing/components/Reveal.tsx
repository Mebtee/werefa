import { useEffect, useRef, useState, type ElementType, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * Scroll-reveal wrapper for the marketing page.
 *
 * Progressive enhancement only: content is always in the DOM and readable. When
 * the user prefers reduced motion, or when IntersectionObserver is unavailable
 * (older browsers, jsdom in tests), the element renders in its final, visible
 * state immediately — nothing is ever hidden behind an animation.
 */
function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false
  }
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

interface RevealProps {
  children: ReactNode
  className?: string
  /** Element to render; defaults to a div. */
  as?: ElementType
  /** Stagger delay in milliseconds, applied only when motion is allowed. */
  delay?: number
}

export function Reveal({ children, className, as: Tag = 'div', delay = 0 }: RevealProps) {
  const ref = useRef<HTMLElement | null>(null)
  const [visible, setVisible] = useState(() => prefersReducedMotion())

  useEffect(() => {
    if (visible) return
    const node = ref.current
    if (!node || typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true)
            observer.disconnect()
            break
          }
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -48px 0px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [visible])

  return (
    <Tag
      ref={ref}
      className={cn('mkt-reveal', visible && 'mkt-reveal--in', className)}
      style={delay > 0 ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </Tag>
  )
}
