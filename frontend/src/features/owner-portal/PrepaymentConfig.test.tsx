import { beforeEach, describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderAppAt } from '@/test/auth'
import { getBusiness, resetStore } from '@/mock/store'
import { PRIMARY_BUSINESS_SLUG } from '@/mock/data'

/**
 * Owner prepayment configuration surface (REQ-110 / REQ-111).
 *
 * This panel is the only place a deposit can be turned on, and it is what makes
 * the customer receipt-upload step reachable. It writes nothing but the real
 * `PATCH /owner/businesses/:id/settings` payload — no platform default is
 * applied and no percentage is invented.
 */

const user = userEvent.setup()

beforeEach(() => {
  resetStore()
})

function renderProfile() {
  return renderAppAt('/owner/business')
}

describe('owner deposit configuration', () => {
  it('reports the real backend configuration instead of a hard-coded default', async () => {
    renderProfile()

    await screen.findByRole('heading', { name: 'Deposit' })
    // The fixture business genuinely has a 20% deposit configured, so the panel
    // must show that real value — never a hard-coded platform default.
    expect(screen.getByText(/prepay 20% of the booking total/i)).toBeInTheDocument()
    expect(
      screen.getByRole('radio', { name: /a percentage of the booking total/i }),
    ).toBeChecked()
  })

  it('requires a percentage and stores it on the real settings route (REQ-111)', async () => {
    const { stub } = renderProfile()
    await screen.findByRole('heading', { name: 'Deposit' })
    const percent = screen.getByLabelText(/^percentage of the booking total$/i)

    // An empty value is refused before anything leaves the browser.
    await user.clear(percent)
    await user.click(screen.getByRole('button', { name: /save deposit/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      `Enter a whole number between 1 and 100.`,
    )
    expect(
      stub.calls.some((c) => c.method === 'PATCH' && c.url.endsWith('/settings')),
    ).toBe(false)

    // An out-of-range value never becomes a network call either.
    await user.type(percent, '250')
    expect(percent).toBeInvalid()
    await user.click(screen.getByRole('button', { name: /save deposit/i }))
    expect(
      stub.calls.some((c) => c.method === 'PATCH' && c.url.endsWith('/settings')),
    ).toBe(false)

    await user.clear(percent)
    await user.type(percent, '30')
    await user.click(screen.getByRole('button', { name: /save deposit/i }))

    await waitFor(() => expect(getBusiness(PRIMARY_BUSINESS_SLUG)!.prepayment).toEqual({
      mode: 'percentage',
      value: 30,
    }))
    const patch = stub.calls.find((c) => c.method === 'PATCH' && c.url.endsWith('/settings'))
    expect(patch?.body).toMatchObject({
      prepaymentMode: 'PERCENTAGE',
      prepaymentPercent: 30,
    })
  })

  it('stores a fixed amount in minor units and can clear the deposit again', async () => {
    const { stub } = renderProfile()
    await screen.findByRole('heading', { name: 'Deposit' })

    await user.click(screen.getByRole('radio', { name: /^a fixed amount$/i }))
    await user.type(screen.getByLabelText(/^fixed amount \(/i), '75.50')
    await user.click(screen.getByRole('button', { name: /save deposit/i }))
    await waitFor(() =>
      expect(getBusiness(PRIMARY_BUSINESS_SLUG)!.prepayment).toEqual({
        mode: 'fixed',
        value: 7550,
      }),
    )
    const patch = stub.calls.find((c) => c.method === 'PATCH' && c.url.endsWith('/settings'))
    expect(patch?.body).toMatchObject({
      prepaymentMode: 'FIXED',
      prepaymentFixedMinor: 7550,
    })

    // Turning it back off restores the honest "no deposit" state.
    await user.click(screen.getByRole('radio', { name: /no deposit/i }))
    await user.click(screen.getByRole('button', { name: /save deposit/i }))
    await waitFor(() =>
      expect(getBusiness(PRIMARY_BUSINESS_SLUG)!.prepayment).toEqual({ mode: 'none' }),
    )
    const clearPatch = stub.calls
      .filter((c) => c.method === 'PATCH' && c.url.endsWith('/settings'))
      .at(-1)
    expect(clearPatch?.body).toMatchObject({ prepaymentMode: 'NONE' })
  })

  it('is honest that a fixed amount of 0 asks for no deposit', async () => {
    const { stub } = renderProfile()
    await screen.findByRole('heading', { name: 'Deposit' })

    await user.click(screen.getByRole('radio', { name: /^a fixed amount$/i }))
    await user.type(screen.getByLabelText(/^fixed amount \(/i), '0')
    await user.click(screen.getByRole('button', { name: /save deposit/i }))

    // The backend accepts 0, so the panel must not pretend a deposit is due.
    await waitFor(() =>
      expect(getBusiness(PRIMARY_BUSINESS_SLUG)!.prepayment).toEqual({
        mode: 'fixed',
        value: 0,
      }),
    )
    expect(screen.getByText(/prepay etb 0\.00/i)).toBeInTheDocument()
    const patch = stub.calls.find((c) => c.method === 'PATCH' && c.url.endsWith('/settings'))
    expect(patch?.body).toMatchObject({ prepaymentMode: 'FIXED', prepaymentFixedMinor: 0 })
  })

  it('never offers a payment method or a payment instruction of its own', async () => {
    renderProfile()
    await screen.findByRole('heading', { name: 'Deposit' })
    const panel = screen.getByRole('region', { name: 'Deposit' })
    expect(panel.textContent).not.toMatch(/stripe|paypal|crypto|credit card/i)
    expect(panel.textContent).not.toMatch(/account number|bank name|wallet/i)
  })
})
