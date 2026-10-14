export interface EthiopianBank {
  code: string
  name: string
  amharicName: string
  shortName: string
  color: string
  category: 'bank' | 'mobile_money'
  icon: string
}

export interface ConfiguredPaymentAccount {
  id: string
  bankCode: string
  institutionName: string
  accountNum: string
  holderName: string
  isPrimary?: boolean
  notes?: string
}

export const ETHIOPIAN_BANKS: EthiopianBank[] = [
  {
    code: 'telebirr',
    name: 'Telebirr (Ethio Telecom)',
    amharicName: 'ቴሌብር (ኢትዮ ቴሌኮም)',
    shortName: 'Telebirr',
    color: '#0072BC',
    category: 'mobile_money',
    icon: 'ri-smartphone-line',
  },
  {
    code: 'cbe',
    name: 'Commercial Bank of Ethiopia (CBE)',
    amharicName: 'የኢትዮጵያ ንግድ ባንክ',
    shortName: 'CBE',
    color: '#841575',
    category: 'bank',
    icon: 'ri-bank-line',
  },
  {
    code: 'boa',
    name: 'Bank of Abyssinia (BOA)',
    amharicName: 'የአቢሲኒያ ባንክ',
    shortName: 'Abyssinia',
    color: '#E5901A',
    category: 'bank',
    icon: 'ri-bank-fill',
  },
  {
    code: 'awash',
    name: 'Awash Bank',
    amharicName: 'አዋሽ ባንክ',
    shortName: 'Awash',
    color: '#0070B8',
    category: 'bank',
    icon: 'ri-building-line',
  },
  {
    code: 'dashen',
    name: 'Dashen Bank (Amole)',
    amharicName: 'ዳሽን ባንክ (አሞሌ)',
    shortName: 'Dashen',
    color: '#1B3B8B',
    category: 'bank',
    icon: 'ri-funds-line',
  },
  {
    code: 'coop',
    name: 'Cooperative Bank of Oromia (Coopay)',
    amharicName: 'የኦሮሚያ ኅብረት ሥራ ባንክ (ኮኦፔይ)',
    shortName: 'Coopay',
    color: '#D8232A',
    category: 'bank',
    icon: 'ri-wallet-3-line',
  },
  {
    code: 'hibret',
    name: 'Hibret Bank',
    amharicName: 'ሕብረት ባንክ',
    shortName: 'Hibret',
    color: '#F26522',
    category: 'bank',
    icon: 'ri-community-line',
  },
  {
    code: 'nib',
    name: 'Nib International Bank',
    amharicName: 'ንብ ኢንተርናሽናል ባንክ',
    shortName: 'Nib',
    color: '#D48900',
    category: 'bank',
    icon: 'ri-copper-coin-line',
  },
  {
    code: 'wegagen',
    name: 'Wegagen Bank',
    amharicName: 'ወጋገን ባንክ',
    shortName: 'Wegagen',
    color: '#E31B23',
    category: 'bank',
    icon: 'ri-sun-line',
  },
  {
    code: 'zemen',
    name: 'Zemen Bank',
    amharicName: 'ዘመን ባንክ',
    shortName: 'Zemen',
    color: '#A32025',
    category: 'bank',
    icon: 'ri-time-line',
  },
  {
    code: 'berhan',
    name: 'Berhan Bank',
    amharicName: 'ብርሃን ባንክ',
    shortName: 'Berhan',
    color: '#F37023',
    category: 'bank',
    icon: 'ri-lightbulb-line',
  },
  {
    code: 'bunna',
    name: 'Bunna International Bank',
    amharicName: 'ቡና ባንክ',
    shortName: 'Bunna',
    color: '#8C4722',
    category: 'bank',
    icon: 'ri-cup-line',
  },
  {
    code: 'oromia',
    name: 'Oromia Bank',
    amharicName: 'ኦሮሚያ ባንክ',
    shortName: 'Oromia',
    color: '#009245',
    category: 'bank',
    icon: 'ri-seedling-line',
  },
  {
    code: 'lion',
    name: 'Lion International Bank',
    amharicName: 'አንበሳ ኢንተርናሽናል ባንክ',
    shortName: 'Lion',
    color: '#C68E17',
    category: 'bank',
    icon: 'ri-shield-star-line',
  },
  {
    code: 'sinqee',
    name: 'Sinqee Bank',
    amharicName: 'ሲንቄ ባንክ',
    shortName: 'Sinqee',
    color: '#437837',
    category: 'bank',
    icon: 'ri-hand-coin-line',
  },
  {
    code: 'abay',
    name: 'Abay Bank',
    amharicName: 'አባይ ባንክ',
    shortName: 'Abay',
    color: '#005BAA',
    category: 'bank',
    icon: 'ri-water-flash-line',
  },
  {
    code: 'enat',
    name: 'Enat Bank',
    amharicName: 'እናት ባንክ',
    shortName: 'Enat',
    color: '#9B2386',
    category: 'bank',
    icon: 'ri-heart-line',
  },
  {
    code: 'global',
    name: 'Global Bank Ethiopia',
    amharicName: 'ግሎባል ባንክ ኢትዮጵያ',
    shortName: 'Global',
    color: '#2E3192',
    category: 'bank',
    icon: 'ri-global-line',
  },
  {
    code: 'cbebirr',
    name: 'CBE Birr',
    amharicName: 'ሲቢኢ ብር',
    shortName: 'CBE Birr',
    color: '#841575',
    category: 'mobile_money',
    icon: 'ri-cellphone-line',
  },
]

export function getBankByCode(code: string): EthiopianBank | undefined {
  return ETHIOPIAN_BANKS.find((b) => b.code === code)
}

const STORAGE_PREFIX = 'werefa_payment_accounts_'

export function loadConfiguredAccounts(
  businessId?: string,
  slug?: string,
): ConfiguredPaymentAccount[] {
  if (typeof window === 'undefined') return []
  try {
    const raw =
      (businessId ? localStorage.getItem(`${STORAGE_PREFIX}${businessId}`) : null) ||
      (slug ? localStorage.getItem(`${STORAGE_PREFIX}${slug}`) : null)
    if (!raw) return []
    const parsed = JSON.parse(raw) as ConfiguredPaymentAccount[]
    if (Array.isArray(parsed)) return parsed
  } catch {
    // Ignore storage parse errors
  }
  return []
}

export function saveConfiguredAccounts(
  businessId: string | undefined,
  slug: string | undefined,
  accounts: ConfiguredPaymentAccount[],
): void {
  if (typeof window === 'undefined') return
  try {
    const serialized = JSON.stringify(accounts)
    if (businessId) {
      localStorage.setItem(`${STORAGE_PREFIX}${businessId}`, serialized)
    }
    if (slug) {
      localStorage.setItem(`${STORAGE_PREFIX}${slug}`, serialized)
    }
    window.dispatchEvent(new CustomEvent('werefa_payment_accounts_updated'))
  } catch {
    // Ignore storage errors
  }
}

export function getEffectivePaymentAccounts(business: {
  id?: string
  slug?: string
  name: string
  phone: string
}): ConfiguredPaymentAccount[] {
  const custom = loadConfiguredAccounts(business.id, business.slug)
  if (custom.length > 0) return custom

  // Sensible default derived from the business identity
  const phone = business.phone.trim() || '0911223344'
  const cbeAcc = '1000' + (business.phone.replace(/\D/g, '').slice(-8) || '29485721')

  return [
    {
      id: 'default-telebirr',
      bankCode: 'telebirr',
      institutionName: 'Telebirr (ቴሌብር)',
      accountNum: phone,
      holderName: business.name,
      isPrimary: true,
    },
    {
      id: 'default-cbe',
      bankCode: 'cbe',
      institutionName: 'CBE / Commercial Bank of Ethiopia',
      accountNum: cbeAcc,
      holderName: business.name,
    },
  ]
}
