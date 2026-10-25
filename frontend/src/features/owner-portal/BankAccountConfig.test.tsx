import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BankAccountConfigCard } from '@/features/owner-portal/components/BankAccountConfigCard'
import { ETHIOPIAN_BANKS, loadConfiguredAccounts } from '@/lib/ethiopianBanks'
import type { BusinessDetails } from '@/types/models'

const user = userEvent.setup()
const BUSINESS_ID = 'biz-test-123'

const mockBusiness = {
  name: 'Addis Barber & Lounge',
  category: 'salon-barber',
  description: 'Top notch grooming',
  phone: '+251911223344',
  address: 'Bole, Addis Ababa',
  lat: 9.01,
  lng: 38.75,
  slug: 'addis-barber',
  currency: 'ETB',
  prepayment: { mode: 'none' },
  activeScheduleVersionId: 'sched-1',
} as unknown as BusinessDetails

beforeEach(() => {
  localStorage.clear()
})

describe('BankAccountConfigCard', () => {
  it('renders receiving accounts card with at least 15 Ethiopian banks in the dropdown', () => {
    render(<BankAccountConfigCard businessId={BUSINESS_ID} business={mockBusiness} />)

    expect(
      screen.getByRole('heading', { name: /Payment & Receiving Accounts/i }),
    ).toBeInTheDocument()

    // Verify at least 15 banks are available
    expect(ETHIOPIAN_BANKS.length).toBeGreaterThanOrEqual(15)

    const select = screen.getByLabelText(/Select Bank or Wallet/i)
    expect(select).toBeInTheDocument()

    // Confirm major Ethiopian institutions are present
    expect(screen.getByRole('option', { name: /Telebirr/i })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Commercial Bank of Ethiopia/i })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Bank of Abyssinia/i })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Awash Bank/i })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Dashen Bank/i })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /Cooperative Bank of Oromia/i })).toBeInTheDocument()
  })

  it('allows owner to add a new bank account and saves to local storage', async () => {
    render(<BankAccountConfigCard businessId={BUSINESS_ID} business={mockBusiness} />)

    const bankSelect = screen.getByLabelText(/Select Bank or Wallet/i)
    await user.selectOptions(bankSelect, 'boa')

    const numInput = screen.getByLabelText(/Account \/ Mobile Number/i)
    await user.type(numInput, '1088492049')

    const holderInput = screen.getByLabelText(/Account Holder Name/i)
    await user.clear(holderInput)
    await user.type(holderInput, 'Addis Barber PLC')

    await user.click(screen.getByRole('button', { name: /Add Account/i }))

    await waitFor(() => {
      expect(screen.getByText('1088492049')).toBeInTheDocument()
    })
    expect(screen.getByText(/Addis Barber PLC/)).toBeInTheDocument()

    // Check localStorage persistence
    const saved = loadConfiguredAccounts(BUSINESS_ID, mockBusiness.slug)
    expect(saved.some((a) => a.accountNum === '1088492049')).toBe(true)
  })

  it('allows owner to delete an account', async () => {
    render(<BankAccountConfigCard businessId={BUSINESS_ID} business={mockBusiness} />)

    const deleteButtons = screen.getAllByRole('button', { name: /Remove/i })
    const initialCount = deleteButtons.length

    await user.click(deleteButtons[0])

    await waitFor(() => {
      const remainingButtons = screen.queryAllByRole('button', { name: /Remove/i })
      expect(remainingButtons.length).toBe(initialCount - 1)
    })
  })
})
