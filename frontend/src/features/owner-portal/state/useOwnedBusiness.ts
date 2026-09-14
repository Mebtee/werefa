import { useCallback, useEffect, useState } from 'react'
import type { BusinessDetails, Service } from '@/types/models'
import { mockOwnerApi } from '@/mock/ownerApi'

export interface OwnedBusinessState {
  business: BusinessDetails | null
  services: readonly Service[]
  bookingsToday: number
  loading: boolean
  error: boolean
  reload: () => Promise<void>
}

/** Loads the business owned by the mock session plus its services. */
export function useOwnedBusiness(): OwnedBusinessState {
  const [business, setBusiness] = useState<BusinessDetails | null>(null)
  const [services, setServices] = useState<readonly Service[]>([])
  const [bookingsToday, setBookingsToday] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const [biz, svcs, today] = await Promise.all([
        mockOwnerApi.getOwnedBusiness(),
        mockOwnerApi.getServices(),
        mockOwnerApi.getTodayPreview(),
      ])
      setBusiness(biz)
      setServices(svcs)
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

  return { business, services, bookingsToday, loading, error, reload }
}