import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import { Response } from 'express';
import { DATABASE, DatabasePort } from '../database/database.port';
import { CONFIG } from '../config/config.constants';
import { AppConfig, reportPendingProductParameters } from '../config/app-config';

const PRODUCT_NAME = 'Werefa';

interface MetaResponse {
  product: string;
  service: string;
  productSpecification: { version: string; status: string; location: string };
  api: { version: string; basePath: string };
  environment: string;
  runtime: { nodejs: string };
  database: { provider: string; configured: boolean };
  productClarifications: ReturnType<typeof reportPendingProductParameters>;
  time: { utc: string };
}

@Controller('system/meta')
export class MetaController {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(DATABASE) private readonly database: DatabasePort,
  ) {}

  @Get()
  metadata(@Res({ passthrough: true }) res: Response): MetaResponse {
    res.status(HttpStatus.OK);
    return {
      product: PRODUCT_NAME,
      service: 'werefa-backend',
      productSpecification: {
        version: '1.0.0-DRAFT',
        status: 'DRAFT — PENDING PRODUCT OWNER APPROVAL',
        location: 'docs/WEREFA-COMPLETE-SPECIFICATION.md',
      },
      api: { version: 'v1', basePath: '/api/v1' },
      environment: this.config.nodeEnv,
      runtime: { nodejs: process.version },
      database: { provider: 'postgresql', configured: this.database.configured },
      productClarifications: reportPendingProductParameters(this.config),
      time: { utc: new Date().toISOString() },
    };
  }
}