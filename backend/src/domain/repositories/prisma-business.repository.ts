import { Inject, Injectable } from '@nestjs/common';
import { Business, Prisma, PrismaClient } from '@prisma/client';
import { PRISMA_CLIENT } from '../../config/config.constants';
import {
  BusinessRepository,
  BusinessWithOwner,
  CreateBusinessArgs,
} from './business.repository.port';

@Injectable()
export class PrismaBusinessRepository implements BusinessRepository {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async createForOwner(tx: Prisma.TransactionClient, args: CreateBusinessArgs): Promise<Business> {
    return tx.business.create({
      data: {
        publicSlug: args.publicSlug.toLowerCase(),
        categoryCode: args.categoryCode,
        name: args.name,
        description: args.description,
        address: args.address,
        phonePublic: args.phonePublic,
        settings: {
          create: { bookingIntervalMins: args.bookingIntervalMinutes },
        },
        owners: {
          create: { userId: args.ownerId },
        },
      },
    });
  }

  async findBySlug(slug: string): Promise<BusinessWithOwner | null> {
    return this.prisma.business.findUnique({
      where: { publicSlug: slug.toLowerCase() },
      include: {
        owners: { select: { userId: true, createdAt: true } },
        category: true,
      },
    });
  }

  async findById(id: string): Promise<BusinessWithOwner | null> {
    return this.prisma.business.findUnique({
      where: { id },
      include: {
        owners: { select: { userId: true, createdAt: true } },
        category: true,
      },
    });
  }

  async listByOwner(userId: string): Promise<BusinessWithOwner[]> {
    return this.prisma.business.findMany({
      where: { owners: { some: { userId } } },
      include: {
        owners: { select: { userId: true, createdAt: true } },
        category: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getSettings(businessId: string): Promise<import('@prisma/client').BusinessSettings | null> {
    return this.prisma.businessSettings.findUnique({ where: { businessId } });
  }

  async updateProfile(
    tx: Prisma.TransactionClient,
    args: {
      businessId: string;
      name?: string;
      description?: string;
      address?: string;
      phonePublic?: string;
      categoryCode?: string;
      latitude?: number;
      longitude?: number;
    },
  ): Promise<Business> {
    return tx.business.update({
      where: { id: args.businessId },
      data: {
        name: args.name,
        description: args.description,
        address: args.address,
        phonePublic: args.phonePublic,
        categoryCode: args.categoryCode,
        latitude: args.latitude,
        longitude: args.longitude,
      },
    });
  }

  async changeSlug(
    tx: Prisma.TransactionClient,
    args: { businessId: string; publicSlug: string },
  ): Promise<Business> {
    return tx.business.update({
      where: { id: args.businessId },
      data: { publicSlug: args.publicSlug.toLowerCase() },
    });
  }

  async updateSettings(
    tx: Prisma.TransactionClient,
    args: {
      businessId: string;
      bookingIntervalMinutes?: number;
      prepaymentMode?: import('@prisma/client').PrepaymentMode;
      prepaymentPercent?: number | null;
      prepaymentFixedMinor?: bigint | null;
    },
  ): Promise<import('@prisma/client').BusinessSettings> {
    return tx.businessSettings.update({
      where: { businessId: args.businessId },
      data: {
        bookingIntervalMins: args.bookingIntervalMinutes,
        prepaymentMode: args.prepaymentMode,
        prepaymentPercent: args.prepaymentPercent,
        prepaymentFixedMinor: args.prepaymentFixedMinor,
      },
    });
  }

  async setPaused(
    tx: Prisma.TransactionClient,
    args: {
      businessId: string;
      isPaused: boolean;
      pauseMessage?: string | null;
      reopenAt?: Date | null;
    },
  ): Promise<import('@prisma/client').BusinessSettings> {
    return tx.businessSettings.update({
      where: { businessId: args.businessId },
      data: {
        isPaused: args.isPaused,
        pauseMessage: args.pauseMessage,
        reopenAt: args.reopenAt,
      },
    });
  }

  async setDeactivated(
    tx: Prisma.TransactionClient,
    args: { businessId: string; deactivatedAt: Date | null },
  ): Promise<Business> {
    return tx.business.update({
      where: { id: args.businessId },
      data: { deactivatedAt: args.deactivatedAt },
    });
  }
}