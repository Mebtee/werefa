import { Module } from '@nestjs/common';
import { IamModule } from '../iam/iam.module';
import { FutureBookingsSeam } from './future-bookings.seam';
import { ServiceController } from './service.controller';
import { ServicePublicController } from './service-public.controller';
import { ServiceSerializer } from './service.serializer';
import { ServiceService } from './service.service';

@Module({
  imports: [IamModule],
  controllers: [ServiceController, ServicePublicController],
  providers: [ServiceService, ServiceSerializer, FutureBookingsSeam],
  exports: [ServiceService, ServiceSerializer],
})
export class ServiceModule {}
