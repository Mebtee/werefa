import { afterEach, describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { AuthProvider } from '@/features/auth/AuthProvider'
import { appRoutes } from '@/routes'
import { installFetchStub } from '@/test/fetch'
import { renderAppAt, UNAUTHENTICATED } from '@/test/auth'

const user = userEvent.setup()

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.()
})

/**
 * Renders `/` with no session and a fetch stub that fails every URL. Any request
 * the marketing page attempted would be recorded — and would mean the page
 * depends on the backend.
 */
function renderMarketing() {
  const stub = installFetchStub([])
  cleanups.push(stub.restore)
  const router = createMemoryRouter(appRoutes, { initialEntries: ['/'] })
  return {
    stub,
    router,
    ...render(
      <AuthProvider initialState={UNAUTHENTICATED}>
        <RouterProvider router={router} />
      </AuthProvider>,
    ),
  }
}

describe('root marketing page', () => {
  it('renders the Werefa marketing page at /', async () => {
    renderMarketing()

    const h1 = screen.getByRole('heading', { level: 1 })
    expect(h1).toHaveTextContent(/run your business/i)
    expect(h1).toHaveTextContent(/let werefa handle the queue/i)
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument()
    expect(screen.getByText(/scheduling & queue management for service businesses/i)).toBeInTheDocument()
  })

  it('renders exactly one h1 (a single, clear page topic)', () => {
    renderMarketing()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it('needs no session and makes no backend request', () => {
    const { stub } = renderMarketing()

    expect(stub.calls).toHaveLength(0)
    expect(screen.getAllByRole('link', { name: /get started/i }).length).toBeGreaterThan(0)
  })

  it('does not render the business booking wizard or link to a business page', () => {
    renderMarketing()

    expect(screen.queryByText(/check my booking status/i)).not.toBeInTheDocument()
    const businessLinks = screen
      .getAllByRole('link')
      .filter((link) => link.getAttribute('href')?.startsWith('/p/'))
    expect(businessLinks).toEqual([])
  })

  it('points the primary CTA at the real registration route', () => {
    renderMarketing()

    for (const link of screen.getAllByRole('link', { name: /get started/i })) {
      expect(link).toHaveAttribute('href', '/owner/register')
    }
    expect(screen.getAllByRole('link', { name: /get started/i }).length).toBeGreaterThan(0)
  })

  it('points the sign-in CTA at the real login route', () => {
    renderMarketing()

    for (const link of screen.getAllByRole('link', { name: /sign in/i })) {
      expect(link).toHaveAttribute('href', '/owner/login')
    }
    expect(screen.getAllByRole('link', { name: /sign in/i }).length).toBeGreaterThan(0)
  })
})

describe('marketing navigation', () => {
  it('opens and closes the mobile menu, closing it after a link is chosen', async () => {
    renderMarketing()

    expect(screen.queryByRole('navigation', { name: 'Mobile' })).not.toBeInTheDocument()

    const toggle = screen.getByRole('button', { name: /open menu/i })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await user.click(toggle)

    const mobileNav = screen.getByRole('navigation', { name: 'Mobile' })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')

    await user.click(within(mobileNav).getByRole('link', { name: 'Features' }))
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('navigation', { name: 'Mobile' })).not.toBeInTheDocument()
  })
})

describe('marketing FAQ', () => {
  it('expands a question and collapses the previous one', async () => {
    renderMarketing()

    expect(screen.getByRole('region', { name: /what is werefa/i })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /who can use werefa/i })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /who can use werefa/i }))

    expect(screen.getByRole('region', { name: /who can use werefa/i })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /what is werefa/i })).not.toBeInTheDocument()
  })
})

describe('reduced motion', () => {
  it('keeps content visible when the user prefers reduced motion', () => {
    const original = window.matchMedia
    window.matchMedia = ((query: string) => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia
    cleanups.push(() => {
      window.matchMedia = original
    })

    renderMarketing()

    // Reveal elements render in their final, visible state — no content is
    // hidden behind an animation that will never play.
    const reveals = document.querySelectorAll('.mkt-reveal')
    expect(reveals.length).toBeGreaterThan(0)
    expect(document.querySelectorAll('.mkt-reveal--in').length).toBe(reveals.length)
    expect(screen.getByRole('heading', { level: 1 })).toBeVisible()
  })
})

describe('marketing content accuracy guards', () => {
  it('introduces no demo business identity, statistic or testimonial', () => {
    renderMarketing()

    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(/addis-beauty-lounge|marathon-auto-care|riverside-dry-cleaning/i)
    expect(text).not.toMatch(/\b\d[\d,]{2,}\+?\s+(businesses|owners|customers|salons)\b/i)
    expect(text).not.toMatch(/testimonial|rated \d|as seen in|trusted by \d/i)
  })

  it('describes the current payment methods and never claims a card gateway', () => {
    renderMarketing()

    const text = document.body.textContent ?? ''
    expect(text).toContain('Bank Transfer')
    expect(text).toMatch(/Telebirr/i)
    expect(text).not.toMatch(/stripe|paypal|visa|mastercard|card gateway/i)
    expect(text).toMatch(/does not process card payments/i)
  })
})

describe('existing routes remain intact', () => {
  it('still renders the business booking page at /p/:slug', async () => {
    renderAppAt('/p/addis-beauty-lounge', { auth: UNAUTHENTICATED })

    expect(
      (await screen.findAllByText(/Addis Beauty Lounge/)).length,
    ).toBeGreaterThan(0)
    expect(screen.queryByRole('heading', { level: 1, name: /run your business/i })).not.toBeInTheDocument()
  })

  it('still renders the owner login page', async () => {
    renderAppAt('/owner/login', { auth: UNAUTHENTICATED })

    expect(await screen.findByRole('heading', { name: /owner sign in/i })).toBeInTheDocument()
  })

  it('still renders the owner registration page', async () => {
    renderAppAt('/owner/register', { auth: UNAUTHENTICATED })

    expect(
      await screen.findByRole('heading', { name: /create an owner account/i }),
    ).toBeInTheDocument()
  })

  it('keeps /admin protected for an unauthenticated visitor', async () => {
    renderAppAt('/admin', { auth: UNAUTHENTICATED })

    expect(await screen.findByRole('heading', { name: /owner sign in/i })).toBeInTheDocument()
  })
})
