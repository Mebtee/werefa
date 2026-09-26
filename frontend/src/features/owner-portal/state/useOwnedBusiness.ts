import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_PUBLIC_BUSINESS_FIELDS, hybridizeOwnedBusiness } from '@/api/business.mapper'
import type { Booking, Service } from '@/types/models'
import { listOwnerServices } from '@/api/catalog'
import { listOwnerBookings } from '@/api/ownerBookings'
import { ownerBookingsFromWire } from '@/features/owner-portal/lib/ownerBooking'
import { useOwnerBusinessContext } from './OwnerBusinessContext'

function utcToday(): string {
  return new Date().toISOString().slice(0, 10)
}

export function useOwnedBusiness() {
  const {
    selectedBusiness,
    loading: businessesLoading,
    error: businessesError,
    reload: reloadBusinesses,
  } = useOwnerBusinessContext()
  const [services, setServices] = useState<Service[]>([])
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const requestIdRef = useRef(0)

  const clearOperationalData = useCallback(() => {
    requestIdRef.current += 1
    setServices([])
    setBookings([])
    setLoading(false)
    setError(false)
  }, [])

  const loadOperationalData = useCallback(async (businessId: string) => {
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    setLoading(true)
    setError(false)

    try {
      const [ownedServices, ownedBookings] = await Promise.all([
        listOwnerServices(businessId),
        listOwnerBookings(businessId),
      ])
      if (requestIdRef.current !== requestId) return
      setServices(ownedServices)
      setBookings(ownerBookingsFromWire(ownedBookings))
    } catch {
      if (requestIdRef.current !== requestId) return
      setServices([])
      setBookings([])
      setError(true)
    } finally {
      if (requestIdRef.current === requestId) setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!selectedBusiness) {
      clearOperationalData()
      return
    }
    void loadOperationalData(selectedBusiness.id)
    return () => {
      requestIdRef.current += 1
    }
  }, [clearOperationalData, loadOperationalData, selectedBusiness])

  const reload = useCallback(async () => {
    const business = await reloadBusinesses()
    if (business) await loadOperationalData(business.id)
    else clearOperationalData()
  }, [clearOperationalData, loadOperationalData, reloadBusinesses])

  const business = useMemo(
    () =>
      selectedBusiness
        ? hybridizeOwnedBusiness(selectedBusiness, DEFAULT_PUBLIC_BUSINESS_FIELDS)
        : null,
    [selectedBusiness],
  )

  return {
    business,
    businessId: selectedBusiness?.id ?? null,
    services,
    bookings,
    bookingsToday: bookings.filter((booking) => booking.date === utcToday()).length,
    loading: businessesLoading || loading,
    error: Boolean(businessesError) || error,
    reload,
  }
}
