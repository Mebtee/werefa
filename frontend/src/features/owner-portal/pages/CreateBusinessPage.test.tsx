import { afterEach, describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { installFetchStub, type FetchStub } from '@/test/fetch'
import { CreateBusinessPage } from './CreateBusinessPage'

const user = userEvent.setup()
let stub: FetchStub | null = null

afterEach(() => {
  stub?.restore()
  stub = null
})

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/owner/business/new']}>
      <CreateBusinessPage />
    </MemoryRouter>,
  )
}

describe('CreateBusinessPage (Prompt 54 onboarding)', () => {
  it('POSTs the allowlisted category to /owner/businesses and never an owner id', async () => {
    stub = installFetchStub([
      {
        method: 'POST',
        path: '/owner/businesses',
        status: 201,
        // Not reached: the page navigates away on success; body assertions below.
        body: { error: { code: 'NONE', title: 'unused', fields: null } },
      },
    ])

    renderPage()
    await user.type(screen.getByLabelText('Public slug'), 'addis-beauty-lounge')
    await user.type(screen.getByLabelText('Business name'), 'Addis Beauty Lounge')
    // Default radio is SALON_AND_BARBER; also confirm OTHER exists.
    await user.click(screen.getByRole('radio', { name: /Other/ }))
    await user.type(screen.getByLabelText('Public phone (optional)'), '+251 911 000 000')
    await user.click(screen.getByRole('button', { name: 'Create business' }))

    await waitFor(() => expect(stub!.calls).toHaveLength(1))
    const call = stub!.calls[0]
    expect(call.url).toContain('/owner/businesses')
    expect(call.method).toBe('POST')
    const payload = call.body as Record<string, unknown>
    expect(payload.categoryCode).toBe('OTHER')
    expect(payload.slug).toBe('addis-beauty-lounge')
    expect(payload.phonePublic).toBe('+251 911 000 000')
    expect(payload).not.toHaveProperty('ownerId')
    expect(payload).not.toHaveProperty('businessId')
  })
})