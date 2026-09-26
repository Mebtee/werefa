import type { OwnerSubscriptionView } from '@/api/types'

export function isoDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString() : ''
}

export function subscriptionBanner(
  subscription: OwnerSubscriptionView,
): { tone: 'info' | 'success' | 'warning' | 'danger'; title: string; text: string } | null {
  if (!subscription.bookingsEnabled) {
    return {
      tone: 'danger',
      title: 'New bookings are closed',
      text:
        subscription.status === 'NONE'
          ? 'New bookings are unavailable. Upload a payment proof for review.'
          : 'Your subscription is closed. Upload a payment proof and bookings will reopen after approval.',
    }
  }

  switch (subscription.status) {
    case 'TRIAL':
      return {
        tone: 'info',
        title: 'Free trial',
        text: subscription.trialEndsAt
          ? `Your free trial runs until ${isoDate(subscription.trialEndsAt)}.`
          : 'Your free trial is running.',
      }
    case 'TRIAL_GRACE':
      return {
        tone: 'warning',
        title: 'Trial grace period',
        text: subscription.trialGraceEndsAt
          ? `Your trial ended. Bookings remain open until ${isoDate(subscription.trialGraceEndsAt)}. Upload a payment proof to keep them open.`
          : 'Your trial ended. Bookings remain open during the grace period.',
      }
    case 'PAID_GRACE':
      return {
        tone: 'warning',
        title: 'Paid grace period',
        text: subscription.paidGraceEndsAt
          ? `Your paid period ended. Bookings remain open until ${isoDate(subscription.paidGraceEndsAt)}. Upload a payment proof to renew.`
          : 'Your paid period ended. Bookings remain open during the grace period.',
      }
    case 'ACTIVE':
      return {
        tone: 'success',
        title: 'Subscription active',
        text: subscription.periodEndsAt
          ? `Your paid subscription runs until ${isoDate(subscription.periodEndsAt)}.`
          : 'Your subscription is active.',
      }
    default:
      return null
  }
}
