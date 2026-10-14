import { useState, useEffect } from 'react'
import type { BusinessDetails } from '@/types/models'
import {
  ETHIOPIAN_BANKS,
  getBankByCode,
  loadConfiguredAccounts,
  saveConfiguredAccounts,
  type ConfiguredPaymentAccount,
} from '@/lib/ethiopianBanks'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'

interface BankAccountConfigCardProps {
  businessId: string
  business: BusinessDetails
}

export function BankAccountConfigCard({ businessId, business }: BankAccountConfigCardProps) {
  const [accounts, setAccounts] = useState<ConfiguredPaymentAccount[]>([])
  const [selectedBankCode, setSelectedBankCode] = useState<string>('telebirr')
  const [accountNumInput, setAccountNumInput] = useState<string>('')
  const [holderNameInput, setHolderNameInput] = useState<string>(business.name)
  const [notesInput, setNotesInput] = useState<string>('')

  const [formError, setFormError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)

  // Load saved accounts on mount or when businessId changes
  useEffect(() => {
    const loaded = loadConfiguredAccounts(businessId, business.slug)
    if (loaded.length > 0) {
      setAccounts(loaded)
    } else {
      // Seed initial accounts using the business's real phone so the owner isn't starting blank
      const phone = business.phone.trim() || '0911223344'
      const cbeAcc = '1000' + (business.phone.replace(/\D/g, '').slice(-8) || '29485721')
      const initial: ConfiguredPaymentAccount[] = [
        {
          id: 'init-telebirr',
          bankCode: 'telebirr',
          institutionName: 'Telebirr (Ethio Telecom)',
          accountNum: phone,
          holderName: business.name,
          isPrimary: true,
        },
        {
          id: 'init-cbe',
          bankCode: 'cbe',
          institutionName: 'Commercial Bank of Ethiopia (CBE)',
          accountNum: cbeAcc,
          holderName: business.name,
        },
      ]
      setAccounts(initial)
      saveConfiguredAccounts(businessId, business.slug, initial)
    }
  }, [businessId, business.slug, business.phone, business.name])

  const handleAddAccount = (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)

    const trimmedNum = accountNumInput.trim()
    const trimmedHolder = holderNameInput.trim()

    if (!trimmedNum) {
      setFormError('Please enter the account or phone number.')
      return
    }

    if (!trimmedHolder) {
      setFormError('Please enter the account holder name.')
      return
    }

    const bank = getBankByCode(selectedBankCode)
    const newAccount: ConfiguredPaymentAccount = {
      id: `acc-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      bankCode: selectedBankCode,
      institutionName: bank ? `${bank.name} · ${bank.amharicName}` : selectedBankCode.toUpperCase(),
      accountNum: trimmedNum,
      holderName: trimmedHolder,
      notes: notesInput.trim() || undefined,
      isPrimary: accounts.length === 0,
    }

    const updated = [...accounts, newAccount]
    setAccounts(updated)
    saveConfiguredAccounts(businessId, business.slug, updated)

    setAccountNumInput('')
    setNotesInput('')
    setFeedback(`Added ${bank?.shortName ?? 'account'} successfully!`)
    setTimeout(() => setFeedback(null), 3500)
  }

  const handleDeleteAccount = (id: string) => {
    const updated = accounts.filter((a) => a.id !== id)
    setAccounts(updated)
    saveConfiguredAccounts(businessId, business.slug, updated)
    setFeedback('Account removed.')
    setTimeout(() => setFeedback(null), 3000)
  }

  const handleSetPrimary = (id: string) => {
    const updated = accounts.map((a) => ({
      ...a,
      isPrimary: a.id === id,
    }))
    setAccounts(updated)
    saveConfiguredAccounts(businessId, business.slug, updated)
    setFeedback('Primary payment account updated.')
    setTimeout(() => setFeedback(null), 3000)
  }

  return (
    <section className="card card--padded" aria-labelledby="bank-accounts-title">
      <div className="card__header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div
            style={{
              width: '42px',
              height: '42px',
              borderRadius: '10px',
              background: 'linear-gradient(135deg, rgba(124, 92, 252, 0.2), rgba(0, 114, 188, 0.2))',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--accent)',
              fontSize: '22px',
            }}
          >
            🏦
          </div>
          <div>
            <h2 id="bank-accounts-title" className="card__title">
              Payment &amp; Receiving Accounts · የክፍያ መቀበያ ሂሳቦች
            </h2>
            <p className="card__subtitle">
              Choose your banks or mobile wallets. Customers will see these accounts with one-tap copy buttons when making pre-payments.
            </p>
          </div>
        </div>
      </div>

      {feedback && (
        <div style={{ marginBottom: '16px' }}>
          <Alert tone="success" live="polite">
            {feedback}
          </Alert>
        </div>
      )}

      {/* List of configured accounts */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '16px' }}>
        {accounts.map((acc) => {
          const bank = getBankByCode(acc.bankCode)
          return (
            <div
              key={acc.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '14px 18px',
                borderRadius: '12px',
                border: acc.isPrimary
                  ? '2px solid var(--accent)'
                  : '1px solid var(--color-border)',
                background: acc.isPrimary
                  ? 'rgba(124, 92, 252, 0.05)'
                  : 'var(--color-surface)',
                boxShadow: 'var(--shadow-sm)',
                flexWrap: 'wrap',
                gap: '12px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                <div
                  style={{
                    width: '38px',
                    height: '38px',
                    borderRadius: '8px',
                    backgroundColor: bank?.color || '#7c5cfc',
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 700,
                    fontSize: '13px',
                    boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
                  }}
                >
                  {bank?.shortName.slice(0, 3).toUpperCase() || 'ETB'}
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontWeight: 700, fontSize: '15px' }}>
                      {bank?.name || acc.institutionName}
                    </span>
                    {bank?.amharicName && (
                      <span style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>
                        ({bank.amharicName})
                      </span>
                    )}
                    {acc.isPrimary && (
                      <span
                        style={{
                          fontSize: '11px',
                          fontWeight: 700,
                          padding: '2px 8px',
                          borderRadius: '100px',
                          background: 'var(--accent)',
                          color: '#fff',
                        }}
                      >
                        PRIMARY
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      fontFamily: 'var(--font-mono, monospace)',
                      fontSize: '14px',
                      fontWeight: 600,
                      color: 'var(--color-text)',
                      marginTop: '3px',
                    }}
                  >
                    {acc.accountNum}
                    <span style={{ fontWeight: 400, color: 'var(--color-text-muted)', marginLeft: '10px' }}>
                      · {acc.holderName}
                    </span>
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {!acc.isPrimary && (
                  <button
                    type="button"
                    className="btn btn--sm btn--outline"
                    onClick={() => handleSetPrimary(acc.id)}
                    title="Set as primary receiving account"
                  >
                    Make Primary
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn--sm btn--ghost"
                  style={{ color: 'var(--color-danger, #ef4444)' }}
                  onClick={() => handleDeleteAccount(acc.id)}
                  aria-label={`Remove ${bank?.shortName ?? 'account'}`}
                >
                  Delete
                </button>
              </div>
            </div>
          )
        })}

        {accounts.length === 0 && (
          <div
            style={{
              padding: '20px',
              textAlign: 'center',
              border: '1px dashed var(--color-border)',
              borderRadius: '12px',
              color: 'var(--color-text-muted)',
            }}
          >
            No accounts configured yet. Add your Telebirr or Ethiopian bank accounts below.
          </div>
        )}
      </div>

      {/* Add New Account Form */}
      <form
        onSubmit={handleAddAccount}
        style={{
          marginTop: '24px',
          padding: '18px',
          borderRadius: '12px',
          background: 'var(--color-surface-subtle, rgba(0,0,0,0.02))',
          border: '1px solid var(--color-border)',
        }}
      >
        <h3 style={{ fontSize: '15px', fontWeight: 700, marginBottom: '14px' }}>
          ➕ Add New Receiving Account / አዲስ የሂሳብ አማራጭ ያክሉ
        </h3>

        {formError && (
          <div style={{ marginBottom: '12px' }}>
            <Alert tone="warning">{formError}</Alert>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
          <div>
            <label
              htmlFor="bank-select"
              style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}
            >
              Select Bank or Wallet (ከ15+ ባንኮች ይምረጡ)
            </label>
            <select
              id="bank-select"
              className="input"
              value={selectedBankCode}
              onChange={(e) => setSelectedBankCode(e.target.value)}
              style={{ width: '100%', height: '42px', borderRadius: '8px' }}
            >
              {ETHIOPIAN_BANKS.map((b) => (
                <option key={b.code} value={b.code}>
                  {b.name} ({b.amharicName})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="account-num-input"
              style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}
            >
              Account / Mobile Number (የሂሳብ ወይም የስልክ ቁጥር)
            </label>
            <input
              id="account-num-input"
              className="input"
              type="text"
              value={accountNumInput}
              onChange={(e) => setAccountNumInput(e.target.value)}
              placeholder="e.g. 100012345678 or 0911223344"
              style={{ width: '100%', height: '42px', borderRadius: '8px' }}
            />
          </div>

          <div>
            <label
              htmlFor="holder-name-input"
              style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}
            >
              Account Holder Name (የሂሳብ ባለቤት ስም)
            </label>
            <input
              id="holder-name-input"
              className="input"
              type="text"
              value={holderNameInput}
              onChange={(e) => setHolderNameInput(e.target.value)}
              placeholder="Business or Owner Full Name"
              style={{ width: '100%', height: '42px', borderRadius: '8px' }}
            />
          </div>
        </div>

        <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'flex-end' }}>
          <Button variant="primary" type="submit">
            Add Account
          </Button>
        </div>
      </form>
    </section>
  )
}
