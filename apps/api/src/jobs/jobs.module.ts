import { Global, Module } from '@nestjs/common';
import { BusinessModule } from '../business/business.module';
import { IamModule } from '../iam/iam.module';
import { JobQueueService } from './job-queue.service';
import { JobRegistrar } from './retention-security-events.job';
import { MailJobRegistrar, PlatformEmailer } from './platform-email.job';
import { ScheduledResumeJob } from './business-scheduled-resume.job';
import { NotificationDeliveryJob } from './notification-delivery.job';

/**
 * Global so identity services can inject PlatformEmailer (seamless test→worker
 * delivery switch) without importing the module at every use-site.
 */
@Global()
@Module({
  imports: [IamModule, BusinessModule],
  providers: [
    JobQueueService,
    JobRegistrar,
    MailJobRegistrar,
    PlatformEmailer,
    ScheduledResumeJob,
    NotificationDeliveryJob,
  ],
  exports: [JobQueueService, PlatformEmailer],
})
export class JobsModule {}
