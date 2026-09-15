import type { ImageAsset, MapProvider, Money, Service, ServiceSelection, TimeOfDay } from '@/types/models'

export function formatMoney(amount: Money, currency: string): string {
  const birr = amount / 100
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(birr)
}

/** "HH:MM" as displayed to customers — always 24-hour (REQ-224). */
export function formatTime(time: TimeOfDay): string {
  return time
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export interface ServiceLineItem {
  service: Service
  selection: ServiceSelection
  name: string
  unitPrice: Money
  durationMinutes: number
}

export function buildLineItems(
  services: readonly Service[],
  selections: readonly ServiceSelection[],
): ServiceLineItem[] {
  return selections.flatMap((selection) => {
    const service = services.find((s) => s.id === selection.serviceId)
    if (!service) return []
    const variation = service.variations.find(
      (v) => v.id === selection.variationId,
    )
    const addOnIds = new Set(selection.addOnIds)
    const addOns = service.addOns.filter((a) => addOnIds.has(a.id))

    const unitPrice =
      service.basePrice +
      (variation?.priceDelta ?? 0) +
      addOns.reduce((sum, a) => sum + a.price, 0)

    const durationMinutes =
      service.baseDurationMinutes +
      (variation?.durationDeltaMinutes ?? 0) +
      addOns.reduce((sum, a) => sum + a.durationMinutes, 0)

    const name = variation
      ? `${service.name} (${variation.name})`
      : service.name

    return [
      {
        service,
        selection,
        name,
        unitPrice,
        durationMinutes,
      },
    ]
  })
}

export function totalPrice(lineItems: readonly ServiceLineItem[]): Money {
  return lineItems.reduce((sum, item) => sum + item.unitPrice, 0)
}

export function totalDurationMinutes(
  lineItems: readonly ServiceLineItem[],
): number {
  return lineItems.reduce((sum, item) => sum + item.durationMinutes, 0)
}

/** Deposit the customer must prepay, per the owner's prepayment config. */
export function prepaymentAmount(config: {
  mode: 'none' | 'percentage' | 'fixed'
  value?: number
}, total: Money): Money | null {
  if (config.mode === 'none') return null
  if (config.mode === 'fixed') return config.value ?? 0
  if (config.mode === 'percentage') {
    const percent = config.value ?? 0
    return Math.ceil((total * percent) / 100)
  }
  return null
}

/** Deterministic map link built from coordinates and provider (REQ-212). */
export function mapUrl(lat: number, lng: number, provider: MapProvider): string {
  const coords = `${lat},${lng}`
  return provider === 'google'
    ? `https://www.google.com/maps/search/?api=1&query=${coords}`
    : `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`
}

/** Absolute public booking page URL derived from the current slug. */
export function publicPageUrl(slug: string): string {
  return `${window.location.origin}/p/${slug}`
}

/** Tiny inline SVG data-URI placeholder used when no logo or cover is set. */
export function initialsDataUrl(name: string): string {
  const parts = name.trim().split(/\s+/)
  const chars =
    parts.length > 1
      ? `${parts[0][0] ?? ''}${parts[parts.length - 1][0] ?? ''}`
      : parts[0]?.slice(0, 2) ?? ''
  const label = chars.toUpperCase() || '?'
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" rx="16" fill="%23b4457f"/><text x="64" y="64" dy=".35em" text-anchor="middle" fill="%23fff" font-family="system-ui,sans-serif" font-size="48" font-weight="700">${label}</text></svg>`
  return `data:image/svg+xml,${svg}`
}

/** Safe `<img>` src: returns the data-URL when the asset exists, null otherwise. */
export function imageSrc(asset: ImageAsset | null): string | null {
  return asset?.dataUrl ?? null
}