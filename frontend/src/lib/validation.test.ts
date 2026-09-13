import { describe, expect, it } from 'vitest'
import { validateCustomerDetails, validateProofFile } from '@/lib/validation'

describe('validateCustomerDetails', () => {
  it('accepts a valid name and phone', () => {
    const result = validateCustomerDetails({
      name: 'Selam Tesfaye',
      phone: '+251911123456',
      note: '',
    })
    expect(result.valid).toBe(true)
  })

  it('rejects an empty name and empty phone', () => {
    const result = validateCustomerDetails({
      name: '',
      phone: '',
      note: '',
    })
    expect(result.valid).toBe(false)
    expect(result.errors.name).toBeDefined()
    expect(result.errors.phone).toBeDefined()
  })

  it('accepts the customer without any note', () => {
    const result = validateCustomerDetails({
      name: 'Test Person',
      phone: '0911 123 456',
      note: '',
    })
    expect(result.valid).toBe(true)
  })
})

describe('validateProofFile', () => {
  it('accepts an image proof', () => {
    const file = new File(['x'], 'proof.png', { type: 'image/png' })
    const result = validateProofFile(file)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.proof.fileName).toBe('proof.png')
  })

  it('rejects a disallowed MIME type', () => {
    const file = new File(['x'], 'evil.txt', { type: 'text/plain' })
    const result = validateProofFile(file)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('not-allowed-type')
  })

  it('rejects an oversized proof', () => {
    const file = new File(['x'.repeat(6 * 1024 * 1024)], 'big.png', {
      type: 'image/png',
    })
    const result = validateProofFile(file)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('too-large')
  })
})