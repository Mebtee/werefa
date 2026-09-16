import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { ReadyController } from './ready.controller';
import { MetaController } from './meta.controller';

/** Platform/system endpoints: liveness, readiness, metadata. No business surface. */
@Module({
  controllers: [HealthController, ReadyController, MetaController],
})
export class SystemModule {}