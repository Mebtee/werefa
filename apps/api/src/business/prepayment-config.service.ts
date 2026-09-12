import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { withOwnerBusinessContext, type TenantTransaction } from '../database/tenant-executor';
import { SecurityEventService } from '../iam/security-events.service';
import { parsePrepaymentConfigInput, type PrepaymentConfigDto } from './prepayment-input';

export interface PrepaymentSettingsRow {
  prepaymentEnabled: boolean;
  prepaymentType: string | null;
  prepaymentPercentage: number | null;
  prepaymentFixedMinor: bigint | null;
}

function toMinorUnits(value: bigint | null): number | null {
  return value === null ? null : Number(value);
}

export function toPrepaymentConfig(row: PrepaymentSettingsRow): PrepaymentConfigDto {
  if (!row.prepaymentEnabled) {
    return { enabled: false, type: null, percentage: null, fixedMinor: null };
  }
  if (row.prepaymentType === 'PERCENTAGE') {
    return {
      enabled: true,
      type: 'PERCENTAGE',
      percentage: row.prepaymentPercentage,
      fixedMinor: null,
    };
  }
  if (row.prepaymentType === 'FIXED') {
    return {
      enabled: true,
      type: 'FIXED',
      percentage: null,
      fixedMinor: toMinorUnits(row.prepaymentFixedMinor),
    };
  }
  return { enabled: false, type: null, percentage: null, fixedMinor: null };
}

/**
 * Owner prepayment configuration service (REQ-110/111, Prompt 21).
 *
 * Per-business prepayment config lives on the `business` row; reading is
 * owner-scoped via `withOwnerBusinessContext` (RLS) and writing records a
 * `BUSINESS_PREPAYMENT_CONFIG_UPDATE` audit event.
 */
@Injectable()
export class PrepaymentConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly securityEvents: SecurityEventService,
  ) {}

  /** Read own business prepayment config (owner scope). */
  async getForOwner(userId: string, businessId: string): Promise<PrepaymentConfigDto> {
    return withOwnerBusinessContext(this.prisma, userId, businessId, async (tx) => {
      const business = await tx.business.findUniqueOrThrow({
        where: { id: businessId },
        select: {
          prepaymentEnabled: true,
          prepaymentType: true,
          prepaymentPercentage: true,
          prepaymentFixedMinor: true,
        },
      });
      return toPrepaymentConfig(business as PrepaymentSettingsRow);
    });
  }

  /** Update own business (owner scope) — validates non-mixing of forms. */
  async updateForOwner(
    userId: string,
    businessId: string,
    body: unknown,
  ): Promise<PrepaymentConfigDto> {
    const input = parsePrepaymentConfigInput(body);
    return withOwnerBusinessContext(this.prisma, userId, businessId, async (tx) => {
      const business = await tx.business.update({
        where: { id: businessId },
        data: {
          prepaymentEnabled: input.enabled,
          prepaymentType: input.enabled ? (input.type ?? null) : null,
          prepaymentPercentage:
            input.enabled && input.type === 'PERCENTAGE' ? (input.percentage ?? null) : null,
          prepaymentFixedMinor:
            input.enabled && input.type === 'FIXED' ? (input.fixedMinor ?? null) : null,
        },
      });
      await this.securityEvents.record(
        {
          type: 'BUSINESS_PREPAYMENT_CONFIG_UPDATE',
          userId,
          businessId,
          result: 'SUCCESS',
          metadata: input.enabled
            ? {
                mode: input.type ?? null,
                value:
                  input.type === 'PERCENTAGE'
                    ? (input.percentage ?? null)
                    : (input.fixedMinor?.toString() ?? null),
              }
            : { mode: null, value: null },
        },
        tx,
      );
      return toPrepaymentConfig(business as PrepaymentSettingsRow);
    });
  }

  /** Read a business's prepayment config inside a booking-context transaction. */
  async getForBooking(tx: TenantTransaction, businessId: string): Promise<PrepaymentSettingsRow> {
    const business = await tx.business.findUniqueOrThrow({
      where: { id: businessId },
      select: {
        prepaymentEnabled: true,
        prepaymentType: true,
        prepaymentPercentage: true,
        prepaymentFixedMinor: true,
      },
    });
    return business as PrepaymentSettingsRow;
  }
}

/**
 * Pure derivation of the prepaid amount snapshotted onto `payment` at booking
 * creation (REQ-110). Kept side-effect-free for unit testing.
 *
 * - DISABLED → 0n (no deposit).
 * - PERCENTAGE → `floor(total * pct / 100)` minor units.
 * - FIXED → the configured amount.
 */
export function derivePrepaidMinor(row: PrepaymentSettingsRow, totalPriceMinor: bigint): bigint {
  if (!row.prepaymentEnabled) return 0n;
  if (row.prepaymentType === 'PERCENTAGE' && row.prepaymentPercentage !== null) {
    return (totalPriceMinor * BigInt(row.prepaymentPercentage)) / 100n;
  }
  if (row.prepaymentType === 'FIXED' && row.prepaymentFixedMinor !== null) {
    return row.prepaymentFixedMinor;
  }
  return 0n;
}
