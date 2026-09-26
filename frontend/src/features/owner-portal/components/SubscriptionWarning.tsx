import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Alert } from '@/components/ui/Alert'
import { getOwnerSubscription } from '@/api/subscription'
import type { OwnerSubscriptionView } from '@/api/types'
import { subscriptionBanner } from '@/features/owner-portal/lib/subscriptionPresentation'

const WARNING_STATUSES = new Set<OwnerSubscriptionView['status']>([
  'TRIAL_GRACE',
  'PAID_GRACE',
  'EXPIRED',
  'NONE',
])

export function SubscriptionWarning({ businessId }: { businessId: string }) {
  const [subscription, setSubscription] = useState<OwnerSubscriptionView | null>(null)

  useEffect(() => {
    let active = true
    void getOwnerSubscription(businessId)
      .then((view) => {
        if (active) setSubscription(view)
      })
      .catch(() => {
        if (active) setSubscription(null)
      })
    return () => {
      active = false
    }
  }, [businessId])

  if (!subscription || !WARNING_STATUSES.has(subscription.status)) return null
  const banner = subscriptionBanner(subscription)
  if (!banner) return null

  return (
    <Alert tone={banner.tone} title={banner.title} className="owner-subscription-warning">
      {banner.text}{' '}
      <Link to="/owner/subscription">Review subscription</Link>
    </Alert>
  )
}
