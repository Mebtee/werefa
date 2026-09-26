import { describe, expect, it } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { OwnerBusinessView, OwnerServiceView } from '@/api/types'
import { ownerBusinessStorageKey } from '@/features/owner-portal/state/OwnerBusinessContext'
import { OWNER_PRINCIPAL, renderAppAt } from '@/test/auth'

const user = userEvent.setup()

function business(
  id: string,
  slug: string,
  name: string,
): OwnerBusinessView {
  return {
    id,
    slug,
    name,
    category: { code: 'SALON_AND_BARBER', label: 'Salon & Barber' },
    description: `${name} description`,
    address: `${name} address`,
    phonePublic: null,
    coordinates: { latitude: null, longitude: null },
    isDeactivated: false,
    isPaused: false,
    pauseMessage: null,
    reopenAt: null,
    bookingIntervalMinutes: 30,
    prepaymentMode: 'NONE',
    prepaymentPercent: null,
    prepaymentFixedMinor: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

function service(id: string, name: string): OwnerServiceView {
  return {
    id,
    name,
    basePriceMinor: 1000,
    baseDurationMinutes: 30,
    isActive: true,
    variations: [],
    addOns: [],
  }
}

const alpha = business('business-alpha', 'alpha-salon', 'Alpha Salon')
const beta = business('business-beta', 'beta-studio', 'Beta Studio')
const alphaService = service('service-alpha', 'Alpha haircut')
const betaService = service('service-beta', 'Beta styling')

const multiBusinessOptions = {
  ownedBusinesses: [alpha, beta],
  servicesByBusinessId: {
    [alpha.id]: [alphaService],
    [beta.id]: [betaService],
  },
}

describe('owner business selection', () => {
  it('auto-selects and persists the only owned business', async () => {
    const { stub } = renderAppAt('/owner', {
      businessApi: { ownedBusinesses: [alpha] },
    })

    const switcher = await screen.findByRole('combobox', { name: 'Active business' })
    await waitFor(() => expect(switcher).toHaveValue(alpha.id))
    expect(window.localStorage.getItem(ownerBusinessStorageKey(OWNER_PRINCIPAL.id))).toBe(alpha.id)
    expect(stub.calls.some((call) => call.url.includes(`/owner/businesses/${alpha.id}/services`))).toBe(true)
    expect(stub.calls.some((call) => call.url.includes(`/owner/businesses/${alpha.id}/bookings`))).toBe(true)
  })

  it('restores a valid remembered business for a multi-business owner', async () => {
    renderAppAt('/owner/services', {
      businessApi: multiBusinessOptions,
      initialSelectedBusinessId: beta.id,
    })

    expect(await screen.findByRole('heading', { name: 'Beta styling' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Active business' })).toHaveValue(beta.id)
    expect(window.localStorage.getItem(ownerBusinessStorageKey(OWNER_PRINCIPAL.id))).toBe(beta.id)
    expect(screen.queryByRole('heading', { name: 'Alpha haircut' })).not.toBeInTheDocument()
  })

  it('clears a stale remembered id and requires a choice for multiple businesses', async () => {
    renderAppAt('/owner', {
      businessApi: multiBusinessOptions,
      initialSelectedBusinessId: 'deleted-business',
    })

    expect(await screen.findByRole('heading', { name: 'Choose a business' })).toBeInTheDocument()
    expect(window.localStorage.getItem(ownerBusinessStorageKey(OWNER_PRINCIPAL.id))).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Dashboard' })).not.toBeInTheDocument()
  })

  it('switches operational data and the selected outlet by business id', async () => {
    const { stub } = renderAppAt('/owner/services', {
      businessApi: multiBusinessOptions,
    })

    await user.click(await screen.findByRole('button', { name: /Beta Studio/ }))
    expect(await screen.findByRole('heading', { name: 'Beta styling' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Alpha haircut' })).not.toBeInTheDocument()
    expect(window.localStorage.getItem(ownerBusinessStorageKey(OWNER_PRINCIPAL.id))).toBe(beta.id)

    await user.selectOptions(screen.getByRole('combobox', { name: 'Active business' }), alpha.id)
    expect(await screen.findByRole('heading', { name: 'Alpha haircut' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Beta styling' })).not.toBeInTheDocument()
    expect(window.localStorage.getItem(ownerBusinessStorageKey(OWNER_PRINCIPAL.id))).toBe(alpha.id)
    expect(stub.calls.some((call) => call.url.includes(`/owner/businesses/${alpha.id}/services`))).toBe(true)
    expect(stub.calls.some((call) => call.url.includes(`/owner/businesses/${beta.id}/services`))).toBe(true)
  })

  it('redirects a zero-business owner to onboarding and selects the created business', async () => {
    const { router, stub } = renderAppAt('/owner', {
      businessApi: { ownedBusinesses: [] },
    })

    expect(await screen.findByRole('heading', { name: 'Set up your business' })).toBeInTheDocument()
    await user.type(screen.getByLabelText('Public slug'), 'new-business')
    await user.type(screen.getByLabelText('Business name'), 'New Business')
    await user.click(screen.getByRole('button', { name: 'Create business' }))

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
    expect(screen.getByText('New Business', { selector: '.dashboard-name' })).toBeInTheDocument()
    const selectedId = window.localStorage.getItem(ownerBusinessStorageKey(OWNER_PRINCIPAL.id))
    expect(selectedId).toMatch(/^owner-created-/)
    expect(router.state.location.pathname).toBe('/owner')
    const createCall = stub.calls.find(
      (call) => call.method === 'POST' && call.url.endsWith('/owner/businesses'),
    )
    expect(createCall?.body).toMatchObject({ slug: 'new-business', name: 'New Business' })
    expect(createCall?.body).not.toHaveProperty('ownerId')
  })
})
