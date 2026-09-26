import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { listOwnedBusinesses } from '@/api/business'
import { toUserMessage } from '@/api/errors'
import type { OwnerBusinessView } from '@/api/types'
import { useAuth } from '@/features/auth/useAuth'
import {
  OwnerBusinessContext,
  ownerBusinessStorageKey,
  type OwnerBusinessContextValue,
} from './OwnerBusinessContext'

function readSelectedBusinessId(ownerId: string): string | null {
  try {
    return window.localStorage.getItem(ownerBusinessStorageKey(ownerId))
  } catch {
    return null
  }
}

function writeSelectedBusinessId(ownerId: string, businessId: string | null): void {
  try {
    const key = ownerBusinessStorageKey(ownerId)
    if (businessId) window.localStorage.setItem(key, businessId)
    else window.localStorage.removeItem(key)
  } catch {
    return
  }
}

export function OwnerBusinessProvider({ children }: { children: ReactNode }) {
  const { principal } = useAuth()
  const ownerId = principal?.role === 'OWNER' ? principal.id : null
  const [businesses, setBusinesses] = useState<readonly OwnerBusinessView[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const selectedIdRef = useRef<string | null>(null)
  const ownerIdRef = useRef<string | null>(null)
  const activeRequestRef = useRef<AbortController | null>(null)

  const commitSelection = useCallback(
    (businessId: string | null) => {
      selectedIdRef.current = businessId
      setSelectedId(businessId)
      if (ownerId) writeSelectedBusinessId(ownerId, businessId)
    },
    [ownerId],
  )

  const reload = useCallback(async (): Promise<OwnerBusinessView | null> => {
    if (!ownerId) {
      setBusinesses([])
      commitSelection(null)
      setLoading(false)
      return null
    }

    if (ownerIdRef.current !== ownerId) {
      ownerIdRef.current = ownerId
      selectedIdRef.current = null
      setSelectedId(null)
      setBusinesses([])
    }

    activeRequestRef.current?.abort()
    const controller = new AbortController()
    activeRequestRef.current = controller
    setLoading(true)
    setError(null)

    try {
      const owned = await listOwnedBusinesses(controller.signal)
      if (controller.signal.aborted) return null
      const validIds = new Set(owned.map((business) => business.id))
      const remembered = readSelectedBusinessId(ownerId)
      const nextId = validIds.has(selectedIdRef.current ?? '')
        ? selectedIdRef.current
        : validIds.has(remembered ?? '')
          ? remembered
          : owned.length === 1
            ? owned[0].id
            : null
      setBusinesses(owned)
      commitSelection(nextId)
      return owned.find((business) => business.id === nextId) ?? null
    } catch (error) {
      if (controller.signal.aborted) return null
      setError(toUserMessage(error))
      return null
    } finally {
      if (activeRequestRef.current === controller) {
        activeRequestRef.current = null
        setLoading(false)
      }
    }
  }, [commitSelection, ownerId])

  useEffect(() => {
    void reload()
    return () => {
      activeRequestRef.current?.abort()
    }
  }, [reload])

  const selectBusiness = useCallback(
    (businessId: string) => {
      if (businesses.some((business) => business.id === businessId)) {
        commitSelection(businessId)
      }
    },
    [businesses, commitSelection],
  )

  const addBusiness = useCallback(
    (business: OwnerBusinessView) => {
      setBusinesses((current) => {
        const next = current.some((item) => item.id === business.id)
          ? current.map((item) => (item.id === business.id ? business : item))
          : [...current, business]
        return next
      })
      commitSelection(business.id)
    },
    [commitSelection],
  )

  const selectedBusiness = useMemo(
    () => businesses.find((business) => business.id === selectedId) ?? null,
    [businesses, selectedId],
  )

  const value = useMemo<OwnerBusinessContextValue>(
    () => ({
      businesses,
      selectedBusiness,
      loading,
      error,
      selectBusiness,
      addBusiness,
      reload,
    }),
    [addBusiness, businesses, error, loading, reload, selectBusiness, selectedBusiness],
  )

  return <OwnerBusinessContext.Provider value={value}>{children}</OwnerBusinessContext.Provider>
}
