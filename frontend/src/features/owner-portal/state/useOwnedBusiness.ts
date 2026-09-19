import { useCallback, useEffect, useState } from 'react'
import type { BusinessDetails, Service } from '@/types/models'
import {
  listOwnedBusinesses,
  setPrimaryOwnedBusiness,
} from '@/api/business'
import { listOwnerServices } from '@/api/catalog'
import { hybridizeOwnedBusiness } from '@/api/business.mapper'
import { mockOwnerApi } from '@/mock/ownerApi'

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
 * Loads the real backend business profile (Prompt 45) and the real service
 * catalog (Prompt 46) of the primary owned business, plus the mock store's
 * today preview — booking management stays on the in-memory seam.
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
      const [owned, mockBiz, today] = await Promise.all([
        listOwnedBusinesses(),
        mockOwnerApi.getOwnedBusiness(),
        mockOwnerApi.getTodayPreview(),
      ])
      const primary = owned[0]
      if (!primary) throw new Error('No owned business')
      const view = primary
      setBusinessId(view.id)
      setPrimaryOwnedBusiness({ id: view.id, slug: view.slug })
      const servicesForBusiness = await listOwnerServices(view.id)
      setBusiness(hybridizeOwnedBusiness(view, mockBiz))
      setServices(servicesForBusiness)
      setBookingsToday(today.bookingsToday)
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