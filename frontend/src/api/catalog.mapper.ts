import type { Service, ServiceAddOn, ServiceVariation } from '@/types/models'
import type { OwnerServiceView, PublicServiceView, ServiceVariantView } from './types'

/**
 * Maps the real backend service projections into the UI `Service` model
 * (Prompt 46). The wire shape already matches the domain model (integer-minor
 * money, delta add-ons), so this is a narrow copy — kept separate so the
 * backend remains the single authority on the shape.
 */

function variant(view: ServiceVariantView): ServiceVariation {
  return {
    id: view.id,
    name: view.name,
    priceDeltaMinor: view.priceDeltaMinor,
    durationDeltaMinutes: view.durationDeltaMinutes,
  }
}

function addOn(view: ServiceVariantView): ServiceAddOn {
  return {
    id: view.id,
    name: view.name,
    priceDeltaMinor: view.priceDeltaMinor,
    durationDeltaMinutes: view.durationDeltaMinutes,
  }
}

export function servicesOwnedFromApi(views: readonly OwnerServiceView[]): Service[] {
  return views.map((view) => ({
    id: view.id,
    name: view.name,
    basePriceMinor: view.basePriceMinor,
    baseDurationMinutes: view.baseDurationMinutes,
    isActive: view.isActive,
    variations: view.variations.map(variant),
    addOns: view.addOns.map(addOn),
  }))
}

export function servicesPublicFromApi(views: readonly PublicServiceView[]): Service[] {
  return views.map((view) => ({
    id: view.id,
    name: view.name,
    basePriceMinor: view.basePriceMinor,
    baseDurationMinutes: view.baseDurationMinutes,
    // The public endpoint only returns active services (REQ-079).
    isActive: true,
    variations: view.variations.map(variant),
    addOns: view.addOns.map(addOn),
  }))
}