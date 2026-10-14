import { createContext, useContext, useState, type ReactNode } from 'react'

export type Locale = 'en' | 'am'

export interface LocaleStrings {
  bookNow: string
  bookSubtitle: string
  services: string
  chooseServices: string
  chooseServicesSub: string
  dateTime: string
  pickDateTime: string
  yourDetails: string
  review: string
  reviewBooking: string
  payment: string
  paymentConfirm: string
  bookingSummary: string
  morning: string
  afternoon: string
  evening: string
  addToBooking: string
  removeFromBooking: string
  continue: string
  back: string
  sendRequest: string
  checkStatus: string
  bookAppointment: string
  viewSummary: string
  selectedBooking: string
  downloadReceipt: string
  arrivalPolicy: string
  timesShown24h: string
  englishLabel: string
  amharicLabel: string
}

export const TRANSLATIONS: Record<Locale, LocaleStrings> = {
  en: {
    bookNow: 'Book now',
    bookSubtitle: 'Book in a few short steps. You will review everything, and if a deposit is required you will send your payment proof before the request is sent.',
    services: 'Services',
    chooseServices: 'Choose your services',
    chooseServicesSub: 'You can book several services in one visit. Prices and durations below update as you add options.',
    dateTime: 'Date & time',
    pickDateTime: 'Pick a date and time',
    yourDetails: 'Your details',
    review: 'Review',
    reviewBooking: 'Review your booking',
    payment: 'Payment',
    paymentConfirm: 'Payment & confirmation',
    bookingSummary: 'Booking Summary',
    morning: 'Morning',
    afternoon: 'Afternoon',
    evening: 'Evening',
    addToBooking: 'Add to booking',
    removeFromBooking: 'Remove from booking',
    continue: 'Continue',
    back: 'Back',
    sendRequest: 'Send booking request',
    checkStatus: 'Check my booking status',
    bookAppointment: 'Book an appointment',
    viewSummary: 'View summary',
    selectedBooking: 'Your Selected Booking',
    downloadReceipt: 'Download receipt (PDF)',
    arrivalPolicy: 'Arrival & Cancellation Policy',
    timesShown24h: 'Times shown are 24-hour.',
    englishLabel: 'English',
    amharicLabel: 'አማርኛ',
  },
  am: {
    bookNow: 'አሁን ይያዙ',
    bookSubtitle: 'በቀላል ደረጃዎች ቀጠሮ ይያዙ። ሁሉንም መረጃዎች መርምረው ቅድመ-ክፍያ የሚያስፈልግ ከሆነ የክፍያ ማረጋገጫ ደረሰኝ ያያይዛሉ።',
    services: 'አገልግሎቶች',
    chooseServices: 'አገልግሎት ይምረጡ',
    chooseServicesSub: 'በአንድ ጉብኝት በርካታ አገልግሎቶችን መያዝ ይችላሉ። አገልግሎት ሲመርጡ ዋጋው እና ቆይታው ወዲያውኑ ይሰላል።',
    dateTime: 'ቀን እና ሰዓት',
    pickDateTime: 'ቀን እና ሰዓት ይምረጡ',
    yourDetails: 'የእርስዎ መረጃ',
    review: 'ክለሳ',
    reviewBooking: 'ቦታ ማስያዣዎን ይከልሱ',
    payment: 'ክፍያ',
    paymentConfirm: 'ክፍያ እና ማረጋገጫ',
    bookingSummary: 'የቦታ ማስያዣ ማጠቃለያ',
    morning: 'ጥዋት',
    afternoon: 'ከሰዓት',
    evening: 'ምሽት',
    addToBooking: 'ወደ ቦታ ማስያዣ ያክሉ',
    removeFromBooking: 'ከቦታ ማስያዣ አስወግድ',
    continue: 'ቀጥል',
    back: 'ተመለስ',
    sendRequest: 'የቀጠሮ ጥያቄ ላክ',
    checkStatus: 'የቀጠሮዬን ሁኔታ ተመልከት',
    bookAppointment: 'ቀጠሮ ይያዙ',
    viewSummary: 'ማጠቃለያውን ተመልከት',
    selectedBooking: 'የተመረጠው ቀጠሮ ዝርዝር',
    downloadReceipt: 'ደረሰኝ አውርድ (PDF)',
    arrivalPolicy: 'የመምጫ እና የስረዛ ደንብ',
    timesShown24h: 'ሰዓቶች በ24 ሰዓት አቆጣጠር የተገለጹ ናቸው።',
    englishLabel: 'English',
    amharicLabel: 'አማርኛ',
  },
}

interface CustomerLocaleContextType {
  locale: Locale
  setLocale: (next: Locale) => void
  t: LocaleStrings
}

const CustomerLocaleContext = createContext<CustomerLocaleContextType>({
  locale: 'en',
  setLocale: () => {},
  t: TRANSLATIONS.en,
})

const STORAGE_KEY = 'werefa_customer_locale'

export function CustomerLocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    if (typeof window === 'undefined') return 'en'
    const stored = window.localStorage.getItem(STORAGE_KEY)
    return stored === 'am' ? 'am' : 'en'
  })

  const setLocale = (next: Locale) => {
    setLocaleState(next)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, next)
    }
  }

  const value = {
    locale,
    setLocale,
    t: TRANSLATIONS[locale],
  }

  return (
    <CustomerLocaleContext.Provider value={value}>
      {children}
    </CustomerLocaleContext.Provider>
  )
}

export function useCustomerLocale(): CustomerLocaleContextType {
  return useContext(CustomerLocaleContext)
}
