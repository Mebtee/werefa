import { useCallback, useEffect, useState } from 'react'
import type { BusinessDetails, Service } from '@/types/models'
import {
  listOwnedBusinesses,
  setPrimaryOwnedBusiness,
} from '@/api/business'
import { listOwnerServices } from '@/api/catalog'
import { hybridizeOwnedBusiness } from '@/api/business.mapper'
import { listOwnerBookings } from '@/api/ownerBookings'
import { mockOwnerApi } from '@/mock/ownerApi'

/** Today's date as the UTC wire date-key of a booking slot (`YYYY-MM-DD`). */
function utcToday(): string {
  const now = new Date()
  const y = now.getUTCFullYear()
  const m = String(now.getUTCMonth() + 1).padStart(2, '0')
  const d = String(now.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export interface OwnedBusinessState {
  business: BusinessDetails | null
  /** The real backend id of the primary owned business (tenant-scoped). */
  businessId: string | null
  services: readonly Service[]
  bookingsToday: number
  loading: boolean
  error: boolean
  reload: () => Promise<void>
}

/**
 * Loads the real backend business profile (Prompt 45), the real service
 * catalog (Prompt 46) and the real booking list (Prompt 49/51) of the primary
 * owned business. The profile shape is still hybridized onto the mounting
 * business model via the mock projection (authoritative for the pieces the
 * backend does not carry yet).
 */
export function useOwnedBusiness(): OwnedBusinessState {
  const [business, setBusiness] = useState<BusinessDetails | null>(null)
  const [businessId, setBusinessId] = useState<string | null>(null)
  const [services, setServices] = useState<readonly Service[]>([])
  const [bookingsToday, setBookingsToday] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      // The list endpoint already returns the full owner projection for every
      // owned business, so one request is enough for the primary profile. The
      // service catalog is fetched separately since it needs the real tenant
      // id (never trusted from the client).
      const [owned, mockBiz] = await Promise.all([
        listOwnedBusinesses(),
        mockOwnerApi.getOwnedBusiness(),
      ])
      const primary = owned[0]
      if (!primary) throw new Error('No owned business')
      const view = primary
      setBusinessId(view.id)
      setPrimaryOwnedBusiness({ id: view.id, slug: view.slug })
      const servicesForBusiness = await listOwnerServices(view.id)
      setBusiness(hybridizeOwnedBusiness(view, mockBiz))
      setServices(servicesForBusiness)

      // Today's booking count comes from the real bookings list (Prompt 49) —
      // the wire startAt is a UTC instant whose date-key is the booking slot
      // date in the global timezone.
      const today = utcToday()
      const bookings = await listOwnerBookings(view.id, { limit: 500 })
      setBookingsToday(
        bookings.filter((booking) => booking.startAt.slice(0, 10) === today).length,
      )
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  return { business, businessId, services, bookingsToday, loading, error, reload }
}