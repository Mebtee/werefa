import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import { Response } from 'express';
import { DATABASE, DatabasePort } from '../database/database.port';

interface ReadinessCheck {
  name: 'database';
  status: 'ok' | 'error' | 'disabled';
  latencyMs?: number;
  message?: string;
}

interface ReadinessResponse {
  status: 'ok' | 'error';
  checks: ReadinessCheck[];
}

@Controller('system/ready')
export class ReadyController {
  constructor(@Inject(DATABASE) private readonly database: DatabasePort) {}

  @Get()
  async readiness(@Res({ passthrough: true }) res: Response): Promise<ReadinessResponse> {
    const ping = await this.database.ping();

    const check: ReadinessCheck = ping.ok
      ? { name: 'database', status: 'ok', latencyMs: ping.latencyMs }
      : { name: 'database', status: this.database.configured ? 'error' : 'disabled', message: ping.message };

    const ok = ping.ok;
    res.status(ok ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return { status: ok ? 'ok' : 'error', checks: [check] };
  }
}