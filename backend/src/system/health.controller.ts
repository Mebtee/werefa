import { Controller, Get } from '@nestjs/common';

interface HealthResponse {
  status: 'ok';
  service: 'werefa-backend';
  uptimeSeconds: number;
  timestamp: string;
}

@Controller('system/health')
export class HealthController {
  @Get()
  liveness(): HealthResponse {
    return {
      status: 'ok',
      service: 'werefa-backend',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}