import type { BusinessCategory } from '@/types/models'

export const CATEGORY_LABEL: Record<BusinessCategory, string> = {
  'salon-barber': 'Salon & Barber',
  other: 'Other',
}

export const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const