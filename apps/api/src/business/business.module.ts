import { Module } from '@nestjs/common';
import { IamModule } from '../iam/iam.module';
import { ScheduleModule } from '../schedule/schedule.module';
import { SubscriptionAvailabilityService } from '../subscription/subscription-availability.service';
import { BusinessAdminController } from './business-admin.controller';
import { BusinessController } from './business.controller';
import { BusinessPublicController } from './business-public.controller';
import { BusinessSerializer } from './business.serializer';
import { BusinessService } from './business.service';
import { PrepaymentConfigService } from './prepayment-config.service';

@Module({
  imports: [IamModule, ScheduleModule],
  controllers: [BusinessController, BusinessAdminController, BusinessPublicController],
  providers: [
    BusinessService,
    BusinessSerializer,
    SubscriptionAvailabilityService,
    PrepaymentConfigService,
  ],
  exports: [
    BusinessService,
    BusinessSerializer,
    SubscriptionAvailabilityService,
    PrepaymentConfigService,
  ],
})
export class BusinessModule {}
