import type { ReactNode } from 'react'
import { Alert } from '@/components/ui/Alert'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'

interface LoadStateProps {
  loading: boolean
  error: boolean
  onRetry: () => Promise<void>
  children: ReactNode
}

/** Shared loading/error wrapper for owner pages built on useOwnedBusiness. */
export function LoadState({ loading, error, onRetry, children }: LoadStateProps) {
  if (loading) {
    return (
      <div className="owner-load">
        <Spinner label="Loading your business" />
      </div>
    )
  }
  if (error) {
    return (
      <Alert tone="danger" title="Could not load your business data">
        <div style={{ marginTop: 'var(--space-3)' }}>
          <Button variant="outline" onClick={() => void onRetry()}>
            Try again
          </Button>
        </div>
      </Alert>
    )
  }
  return <>{children}</>
}