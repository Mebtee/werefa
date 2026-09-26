import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { SubscriptionCard } from '@/features/owner-portal/components/SubscriptionCard'
import { useOwnerBusinessContext } from '@/features/owner-portal/state/OwnerBusinessContext'

export default function SubscriptionPage() {
  const navigate = useNavigate()
  const { selectedBusiness } = useOwnerBusinessContext()

  if (!selectedBusiness) return null

  return (
    <div className="page-root">
      <div className="page-head">
        <div>
          <h1 className="page-title">Subscription &amp; billing</h1>
          <p className="page-subtitle">
            Review this business&apos;s subscription and submit manual bank-transfer proof for
            account review.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={() => navigate(-1)}>
          Back
        </Button>
      </div>
      <SubscriptionCard businessId={selectedBusiness.id} />
    </div>
  )
}
