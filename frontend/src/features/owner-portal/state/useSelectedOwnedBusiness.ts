import { useCallback, useMemo } from 'react'
import { DEFAULT_PUBLIC_BUSINESS_FIELDS, hybridizeOwnedBusiness } from '@/api/business.mapper'
import { useOwnerBusinessContext } from './OwnerBusinessContext'

/**
 * The selected owned business on its own, with no operational fetches.
 *
 * `useOwnedBusiness` additionally loads the service catalog and the booking list
 * and reports `loading` until both settle. Pages that do not need that data must
 * not wait for it: the schedule editor, for example, reads only the business, so
 * gating it on two unrelated requests left the working-hours grid stuck on a
 * spinner whenever either of them was slow or failed to settle — even though the
 * schedule it needed was already in hand.
 */
export function useSelectedOwnedBusiness() {
  const { selectedBusiness, loading, error, reload: reloadBusinesses } = useOwnerBusinessContext()

  const business = useMemo(
    () =>
      selectedBusiness
        ? hybridizeOwnedBusiness(selectedBusiness, DEFAULT_PUBLIC_BUSINESS_FIELDS)
        : null,
    [selectedBusiness],
  )

  // Widened to `Promise<void>` for `LoadState`'s `onRetry`, which only needs the
  // refresh to have happened. There is no operational data to re-fetch here.
  const reload = useCallback(async (): Promise<void> => {
    await reloadBusinesses()
  }, [reloadBusinesses])

  return {
    business,
    businessId: selectedBusiness?.id ?? null,
    loading,
    error: error !== null,
    reload,
  }
}
