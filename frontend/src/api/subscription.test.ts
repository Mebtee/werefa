import { afterEach, describe, expect, it } from 'vitest'
import type { OwnerBusinessView, OwnerSubscriptionView } from '@/api/types'
import { getOwnerSubscription, submitSubscriptionProof } from '@/api/subscription'
import {
  installBusinessApiStub,
  type BusinessApiStub,
} from '@/test/businessApi'

let stub: BusinessApiStub | null = null

afterEach(() => {
  stub?.restore()
  stub = null
})

function business(id: string, slug: string): OwnerBusinessView {
  return {
    id,
    slug,
    name: slug,
    category: { code: 'OTHER', label: 'Other' },
    description: null,
    address: null,
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

function subscription(
  status: OwnerSubscriptionView['status'],
  bookingsEnabled: boolean,
): OwnerSubscriptionView {
  return {
    status,
    trialStartedAt: '2026-01-01T00:00:00.000Z',
    trialEndsAt: '2026-01-15T00:00:00.000Z',
    trialGraceEndsAt: '2026-01-20T00:00:00.000Z',
    periodEndsAt: null,
    paidGraceEndsAt: null,
    bookingsEnabled,
    proofs: [],
  }
}

const alpha = business('api-business-alpha', 'api-alpha')
const beta = business('api-business-beta', 'api-beta')

describe('owner subscription API integration', () => {
  it('keeps lifecycle and proof history isolated by business id', async () => {
    stub = installBusinessApiStub(undefined, {
      ownedBusinesses: [alpha, beta],
      subscriptionsByBusinessId: {
        [alpha.id]: subscription('NONE', false),
        [beta.id]: subscription('ACTIVE', true),
      },
    })

    await submitSubscriptionProof(beta.id, 'beta-proof-key', {
      bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      contentType: 'image/png',
      filename: 'beta.png',
    })

    const [alphaView, betaView] = await Promise.all([
      getOwnerSubscription(alpha.id),
      getOwnerSubscription(beta.id),
    ])
    expect(alphaView.status).toBe('NONE')
    expect(alphaView.bookingsEnabled).toBe(false)
    expect(alphaView.proofs).toHaveLength(0)
    expect(betaView.status).toBe('ACTIVE')
    expect(betaView.bookingsEnabled).toBe(true)
    expect(betaView.proofs).toHaveLength(1)
    expect(betaView.proofs[0]?.reviewState).toBe('PENDING')
  })

  it('replays the original proof for the same business and submission key', async () => {
    stub = installBusinessApiStub(undefined, {
      ownedBusinesses: [alpha],
      subscriptionsByBusinessId: { [alpha.id]: subscription('NONE', false) },
    })
    const file = {
      bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      contentType: 'image/png',
      filename: 'transfer.png',
    }

    const first = await submitSubscriptionProof(alpha.id, 'stable-key', file)
    const replay = await submitSubscriptionProof(alpha.id, 'stable-key', file)

    expect(replay.id).toBe(first.id)
    expect((await getOwnerSubscription(alpha.id)).proofs).toHaveLength(1)
    expect(stub.calls.filter((call) => call.method === 'POST')).toHaveLength(2)
  })

  it('rejects reuse of a submission key by another business', async () => {
    stub = installBusinessApiStub(undefined, {
      ownedBusinesses: [alpha, beta],
    })
    const file = {
      bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      contentType: 'image/png',
      filename: 'transfer.png',
    }
    await submitSubscriptionProof(alpha.id, 'shared-key', file)

    await expect(submitSubscriptionProof(beta.id, 'shared-key', file)).rejects.toMatchObject({
      status: 409,
      code: 'IDEMPOTENCY_CONFLICT',
    })
    expect((await getOwnerSubscription(beta.id)).proofs).toHaveLength(0)
  })

  it('surfaces backend proof type and size validation', async () => {
    stub = installBusinessApiStub(undefined, { ownedBusinesses: [alpha] })

    await expect(
      submitSubscriptionProof(alpha.id, 'bad-type', {
        bytes: new Uint8Array([1, 2, 3]),
        contentType: 'text/plain',
        filename: 'note.txt',
      }),
    ).rejects.toMatchObject({ status: 415 })
    await expect(
      submitSubscriptionProof(alpha.id, 'too-large', {
        bytes: new Uint8Array(5 * 1024 * 1024 + 1),
        contentType: 'image/png',
        filename: 'large.png',
      }),
    ).rejects.toMatchObject({ status: 413 })
  })
})
