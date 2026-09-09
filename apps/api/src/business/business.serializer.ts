import { Inject, Injectable } from '@nestjs/common';
import type { Business } from '@prisma/client';
import { API_PREFIX } from '@werefa/shared';
import { APP_CONFIG, type AppConfig } from '../config/environment';

/** Owner-facing detailed business view (full profile + lifecycle). */
export interface BusinessDetailDto extends BaseBusinessDto {
  logoKey: string | null;
  coverKey: string | null;
}

/** Admin/Super Admin view identical to the owner view + owning account. */
export interface BusinessAdminDto extends BusinessDetailDto {
  owner: { userId: string; email: string | null } | null;
}

/** Public page view (curated subset; no internal keys). */
export interface BusinessPublicDto extends BaseBusinessDto {}

interface BaseBusinessDto {
  id: string;
  publicSlug: string;
  name: string;
  category: string | null;
  description: string | null;
  phone: string | null;
  contactEmail: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  googleMapsLink: string | null;
  openStreetMapLink: string | null;
  logoUrl: string | null;
  coverUrl: string | null;
  isPaused: boolean;
  pausedUntil: Date | null;
  pauseMessage: string | null;
  isDeactivated: boolean;
  deactivatedAt: Date | null;
  trialEndsAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  publicUrl: string;
  qrUrl: string;
}

export interface BusinessAdminView {
  business: Business;
  owner: { userId: string; email: string | null } | null;
}

/**
 * Maps a business entity to API-facing DTO. Serialization is centralised so
 * internal storage keys never leak; the owner/Admin view exposes the full
 * profile, the public view a curated subset.
 */
@Injectable()
export class BusinessSerializer {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  ownerView(business: Business): BusinessDetailDto {
    return base(business, this.publicBase(business), true);
  }

  publicView(business: Business): BusinessPublicDto {
    const {
      logoKey: _logoKey,
      coverKey: _coverKey,
      ...rest
    } = base(business, this.publicBase(business), false);
    return rest;
  }

  adminView(
    business: Business,
    owner: { userId: string; email: string | null } | null = null,
  ): BusinessAdminDto {
    return {
      ...base(business, this.publicBase(business), true),
      owner,
    };
  }

  private publicBase(business: Business): { publicUrl: string; qrUrl: string } {
    const slug = business.publicSlug;
    return {
      publicUrl: `${this.config.publicBaseUrl}/b/${slug}`,
      qrUrl: `${API_PREFIX}/public/businesses/${slug}/qr`,
    };
  }
}

function base(
  business: Business,
  urls: { publicUrl: string; qrUrl: string },
  includeKeys: boolean,
): BusinessDetailDto {
  const slug = business.publicSlug;
  return {
    id: business.id,
    publicSlug: slug,
    name: business.name,
    category: business.category,
    description: business.description,
    phone: business.phone,
    contactEmail: business.contactEmail,
    address: business.address,
    latitude: business.latitude?.toNumber() ?? null,
    longitude: business.longitude?.toNumber() ?? null,
    googleMapsLink: business.googleMapsLink,
    openStreetMapLink: business.openStreetMapLink,
    logoUrl: business.logoKey ? `${API_PREFIX}/public/businesses/${slug}/logo` : null,
    coverUrl: business.coverKey ? `${API_PREFIX}/public/businesses/${slug}/cover` : null,
    isPaused: business.isPaused,
    pausedUntil: business.pausedUntil,
    pauseMessage: business.pauseMessage,
    isDeactivated: business.deactivatedAt !== null,
    deactivatedAt: business.deactivatedAt,
    trialEndsAt: business.trialEndsAt,
    createdAt: business.createdAt,
    updatedAt: business.updatedAt,
    publicUrl: urls.publicUrl,
    qrUrl: urls.qrUrl,
    logoKey: includeKeys ? business.logoKey : null,
    coverKey: includeKeys ? business.coverKey : null,
  };
}
