import { Business, BusinessCategory, BusinessSettings, Prisma } from '@prisma/client';

/**
 * Business domain repository — core tenancy persistence (REQ-047 slug uniqueness,
 * REQ-012/013 owner–business relationships, REQ-111 prepayment, REQ-147/148/149
 * pause, REQ-216 deactivation).
 *
 * Business settings, pause, deactivation, profile and slug changes all live
 * inside a single `business_settings` or `business` row. They are written inside
 * the same advisory-locked transaction as the calling domain operation, so the
 * caller never holds stale values.
 */
export interface CreateBusinessArgs {
  publicSlug: string;
  categoryCode: string;
  name: string;
  description?: string;
  address?: string;
  phonePublic?: string;
  ownerId: string;
  bookingIntervalMinutes: number;
}

export interface BusinessWithOwner extends Business {
  owners: { userId: string; createdAt: Date }[];
  category: BusinessCategory;
}

export interface BusinessRepository {
  createForOwner(tx: Prisma.TransactionClient, args: CreateBusinessArgs): Promise<Business>;
  findBySlug(slug: string): Promise<BusinessWithOwner | null>;
  findById(id: string): Promise<BusinessWithOwner | null>;
  listByOwner(userId: string): Promise<Business[]>;
  getSettings(businessId: string): Promise<BusinessSettings | null>;
  updateProfile(
    tx: Prisma.TransactionClient,
    args: {
      businessId: string;
      name?: string;
      description?: string;
      address?: string;
      phonePublic?: string;
      categoryCode?: string;
    },
  ): Promise<Business>;
  changeSlug(tx: Prisma.TransactionClient, args: { businessId: string; publicSlug: string }): Promise<Business>;
  updateSettings(
    tx: Prisma.TransactionClient,
    args: {
      businessId: string;
      bookingIntervalMinutes?: number;
      prepaymentMode?: import('@prisma/client').PrepaymentMode;
      prepaymentPercent?: number | null;
      prepaymentFixedMinor?: bigint | null;
    },
  ): Promise<BusinessSettings>;
  setPaused(
    tx: Prisma.TransactionClient,
    args: {
      businessId: string;
      isPaused: boolean;
      pauseMessage?: string | null;
      reopenAt?: Date | null;
    },
  ): Promise<BusinessSettings>;
  setDeactivated(
    tx: Prisma.TransactionClient,
    args: { businessId: string; deactivatedAt: Date | null },
  ): Promise<Business>;
}