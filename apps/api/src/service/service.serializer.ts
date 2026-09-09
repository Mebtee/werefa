import { Injectable } from '@nestjs/common';
import type { AddOn, Service, ServiceVariation } from '@prisma/client';

/** Owner/Admin-facing child rows (include is_active so the owner can manage). */
export interface ServiceChildDto {
  id: string;
  name: string;
  priceDeltaMinor: number;
  durationDeltaMinutes: number;
  isActive: boolean;
}

/** Owner-facing service detail (full catalog incl. inactive children). */
export interface ServiceDetailDto {
  id: string;
  businessId: string;
  name: string;
  basePriceMinor: number;
  baseDurationMinutes: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  variations: ServiceChildDto[];
  addOns: ServiceChildDto[];
}

/** Public catalog entry (REQ-214): approved customer-facing info only. */
export interface PublicServiceChildDto {
  id: string;
  name: string;
  priceDeltaMinor: number;
  durationDeltaMinutes: number;
}

export interface PublicServiceDto {
  id: string;
  name: string;
  basePriceMinor: number;
  baseDurationMinutes: number;
  variations: PublicServiceChildDto[];
  addOns: PublicServiceChildDto[];
}

export interface ServiceWithChildren {
  service: Service;
  variations: ServiceVariation[];
  addOns: AddOn[];
}

function minor(value: bigint): number {
  // Money is stored as BIGINT minor units; the platform's per-service amount is
  // far below 2^53 so the Number conversion is exact (no float rounding).
  return Number(value);
}

/**
 * Maps service entities to API DTOs. Serialization is centralised so internal
 * representations (bigint minor units, business_id, lifecycle flags) are safe:
 * the owner view is the full catalog, the public view a curated subset that
 * never exposes business_id, lifecycle state or timestamps.
 */
@Injectable()
export class ServiceSerializer {
  ownerView(row: ServiceWithChildren): ServiceDetailDto {
    return {
      id: row.service.id,
      businessId: row.service.businessId,
      name: row.service.name,
      basePriceMinor: minor(row.service.basePriceMinor),
      baseDurationMinutes: row.service.baseDurationMinutes,
      isActive: row.service.isActive,
      createdAt: row.service.createdAt,
      updatedAt: row.service.updatedAt,
      variations: row.variations.map(child),
      addOns: row.addOns.map(child),
    };
  }

  publicView(row: ServiceWithChildren): PublicServiceDto {
    return {
      id: row.service.id,
      name: row.service.name,
      basePriceMinor: minor(row.service.basePriceMinor),
      baseDurationMinutes: row.service.baseDurationMinutes,
      variations: row.variations.map(publicChild),
      addOns: row.addOns.map(publicChild),
    };
  }

  variationView(row: ServiceVariation): ServiceChildDto {
    return child(row);
  }

  addOnView(row: AddOn): ServiceChildDto {
    return child(row);
  }
}

function child(row: ServiceVariation | AddOn): ServiceChildDto {
  return {
    id: row.id,
    name: row.name,
    priceDeltaMinor: minor(row.priceDeltaMinor),
    durationDeltaMinutes: row.durationDeltaMinutes,
    isActive: row.isActive,
  };
}

function publicChild(row: ServiceVariation | AddOn): PublicServiceChildDto {
  return {
    id: row.id,
    name: row.name,
    priceDeltaMinor: minor(row.priceDeltaMinor),
    durationDeltaMinutes: row.durationDeltaMinutes,
  };
}
