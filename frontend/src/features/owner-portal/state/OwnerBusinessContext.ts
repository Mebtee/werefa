import { createContext, useContext } from 'react'
import type { OwnerBusinessView } from '@/api/types'

export interface OwnerBusinessContextValue {
  businesses: readonly OwnerBusinessView[]
  selectedBusiness: OwnerBusinessView | null
  loading: boolean
  error: string | null
  selectBusiness: (businessId: string) => void
  addBusiness: (business: OwnerBusinessView) => void
  reload: () => Promise<OwnerBusinessView | null>
}

export const OwnerBusinessContext = createContext<OwnerBusinessContextValue | null>(null)

export function ownerBusinessStorageKey(ownerId: string): string {
  return `werefa.owner.business.${ownerId}`
}

export function useOwnerBusinessContext(): OwnerBusinessContextValue {
  const context = useContext(OwnerBusinessContext)
  if (!context) {
    throw new Error('useOwnerBusinessContext must be used within an <OwnerBusinessProvider>.')
  }
  return context
}

export function useOptionalOwnerBusinessContext(): OwnerBusinessContextValue | null {
  return useContext(OwnerBusinessContext)
}
