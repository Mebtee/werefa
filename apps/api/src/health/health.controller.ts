import { Controller, Get } from '@nestjs/common';
import { API_PREFIX } from '@werefa/shared';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../database/prisma.service';

/**
 * Health endpoints (liveness + readiness). No secrets, no data, standard
 * k8s/compose probing contract.
 */
@Controller(`${API_PREFIX}/health`)
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get('live')
  live(): { status: string; uptime: number } {
    return { status: 'ok', uptime: process.uptime() };
  }

  @Public()
  @Get('ready')
  async ready(): Promise<{ status: string; db: string }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', db: 'up' };
    } catch {
      return { status: 'degraded', db: 'down' };
    }
  }
}
