import type { ReactNode, SVGProps } from 'react'

/**
 * Customer-facing icon set.
 *
 * Deliberately hand-rolled inline SVG rather than an icon package: the customer
 * journey needs a dozen glyphs and a new runtime dependency is not warranted
 * (and the acceptance gate forbids client-side asset synthesis such as QR
 * drawing, so keeping the icons as plain markup is the consistent choice).
 *
 * Every glyph is decorative. The surrounding control always carries the real
 * accessible name as text, so each icon is `aria-hidden` and `focusable="false"`
 * by default — a caller must deliberately opt in with a `<title>` to give an
 * icon a name of its own, which the journey never needs.
 */

type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'> & {
  size?: number
}

function icon(path: ReactNode, viewBox = '0 0 24 24') {
  const Icon = ({ size = 20, ...rest }: IconProps) => (
    <svg
      width={size}
      height={size}
      viewBox={viewBox}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {path}
    </svg>
  )
  Icon.displayName = 'WerefaIcon'
  return Icon
}

export const CalendarIcon = icon(
  <>
    <rect x="3" y="5" width="18" height="16" rx="3" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </>,
)

export const ClockIcon = icon(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5V12l3 2" />
  </>,
)

export const PinIcon = icon(
  <>
    <path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11Z" />
    <circle cx="12" cy="10" r="2.6" />
  </>,
)

export const PhoneIcon = icon(
  <path d="M6.5 3.5h3l1.5 4-2 1.5a12 12 0 0 0 6 6l1.5-2 4 1.5v3a2 2 0 0 1-2.2 2A17 17 0 0 1 4.5 5.7 2 2 0 0 1 6.5 3.5Z" />,
)

export const ScissorsIcon = icon(
  <>
    <circle cx="6.5" cy="7" r="2.6" />
    <circle cx="6.5" cy="17" r="2.6" />
    <path d="M8.7 8.6 19 18M19 6 8.7 15.4" />
  </>,
)

export const UserIcon = icon(
  <>
    <circle cx="12" cy="8.5" r="3.5" />
    <path d="M5 20a7 7 0 0 1 14 0" />
  </>,
)

export const CheckIcon = icon(<path d="m5 12.5 4.5 4.5L19 7" />)

export const CheckCircleIcon = icon(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="m8 12.5 2.8 2.8L16 10" />
  </>,
)

export const UploadIcon = icon(
  <>
    <path d="M12 15V4M8 8l4-4 4 4" />
    <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
  </>,
)

export const FileIcon = icon(
  <>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z" />
    <path d="M14 3v5h5" />
  </>,
)

export const ArrowRightIcon = icon(<path d="M5 12h13m-5-6 6 6-6 6" />)

export const ReceiptIcon = icon(
  <>
    <path d="M6 3h12v18l-2.5-1.6L13 21l-2.5-1.6L8 21l-2-1.4Z" />
    <path d="M9.5 8h5M9.5 12h5" />
  </>,
)

export const InfoIcon = icon(
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5.5M12 7.8v.4" />
  </>,
)

export const ShieldIcon = icon(
  <>
    <path d="M12 3.5 19 6v6c0 4-3 7.2-7 8.5-4-1.3-7-4.5-7-8.5V6Z" />
    <path d="m9.2 12 2 2 3.6-3.6" />
  </>,
)

export const SearchIcon = icon(
  <>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4 4" />
  </>,
)

export const ChevronDownIcon = icon(<path d="m6 9 6 6 6-6" />)

export const SendIcon = icon(
  <>
    <path d="M21 3 10.5 13.5M21 3l-6.5 18-4-8-8-4Z" />
  </>,
)