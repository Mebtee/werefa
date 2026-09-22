import { useCallback, useEffect, useRef, useState } from 'react'
import {
  acceptOwnerBooking,
  downloadOwnerBookingProof,
  getOwnerBookingDetail,
  rejectOwnerBooking,
} from '@/api/ownerBookings'
import { toUserMessage } from '@/api/errors'
import {
  paymentReviewFromDetail,
  type OwnerPaymentReview,
  type OwnerProofReview,
} from '@/features/owner-portal/lib/paymentReview'

/**
 * Owner payment-proof review controller (Prompt 51).
 *
 * Loads the real owner booking detail (booking + payment status + proof
 * timeline) from the backend and exposes the accept / reject / download
 * operations. Booking id is the route's owner booking id and `businessId` is the
 * owner-scoped business id, so every call is tenant-scoped server-side. All
 * mutation results refresh the review from the backend projection — the UI never
 * assumes the new state locally.
 */

export interface UsePaymentReview {
  review: OwnerPaymentReview | null
  loading: boolean
  /** Load failure message, or null. */
  error: string | null
  /** True while an accept/reject mutation is in flight. */
  reviewing: boolean
  /** Last accept/reject/download failure message, or null. */
  actionError: string | null
  reload: () => Promise<void>
  /** Returns true on success so the caller can refresh related views. */
  accept: () => Promise<boolean>
  /** Returns true on success so the caller can refresh related views. */
  reject: (reason: string) => Promise<boolean>
  download: (proof: OwnerProofReview) => Promise<void>
  clearActionError: () => void
}

/** Triggers a client-side download of a Blob under the given filename. */
function saveBlob(blob: Blob, fileName: string | null): void {
  const url = URL.createObjectURL(blob)
  try {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = fileName ?? 'payment-proof'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function usePaymentReview(
  businessId: string | null,
  bookingId: string | undefined,
): UsePaymentReview {
  const [review, setReview] = useState<OwnerPaymentReview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reviewing, setReviewing] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const activeRef = useRef(true)

  useEffect(() => {
    activeRef.current = true
    return () => {
      activeRef.current = false
    }
  }, [])

  const reload = useCallback(async () => {
    if (!businessId || !bookingId) return
    setLoading(true)
    setError(null)
    try {
      const detail = await getOwnerBookingDetail(businessId, bookingId)
      if (!activeRef.current) return
      setReview(paymentReviewFromDetail(detail))
    } catch (caught) {
      if (!activeRef.current) return
      setReview(null)
      setError(toUserMessage(caught))
    } finally {
      if (activeRef.current) setLoading(false)
    }
  }, [businessId, bookingId])

  useEffect(() => {
    void reload()
  }, [reload])

  const mutate = useCallback(
    async (action: () => Promise<Awaited<ReturnType<typeof acceptOwnerBooking>>>) => {
      setReviewing(true)
      setActionError(null)
      try {
        const detail = await action()
        if (activeRef.current) setReview(paymentReviewFromDetail(detail))
        return true
      } catch (caught) {
        if (activeRef.current) setActionError(toUserMessage(caught))
        return false
      } finally {
        if (activeRef.current) setReviewing(false)
      }
    },
    [],
  )

  const accept = useCallback(() => {
    if (!businessId || !bookingId) return Promise.resolve(false)
    return mutate(() => acceptOwnerBooking(businessId, bookingId))
  }, [businessId, bookingId, mutate])

  const reject = useCallback(
    (reason: string) => {
      if (!businessId || !bookingId) return Promise.resolve(false)
      return mutate(() => rejectOwnerBooking(businessId, bookingId, reason))
    },
    [businessId, bookingId, mutate],
  )

  const download = useCallback(
    async (proof: OwnerProofReview) => {
      if (!businessId || !bookingId) return
      setActionError(null)
      try {
        const result = await downloadOwnerBookingProof(businessId, bookingId, proof.proofId)
        saveBlob(result.blob, result.fileName ?? proof.fileName)
      } catch (caught) {
        if (activeRef.current) setActionError(toUserMessage(caught))
      }
    },
    [businessId, bookingId],
  )

  const clearActionError = useCallback(() => setActionError(null), [])

  return {
    review,
    loading,
    error,
    reviewing,
    actionError,
    reload,
    accept,
    reject,
    download,
    clearActionError,
  }
}
