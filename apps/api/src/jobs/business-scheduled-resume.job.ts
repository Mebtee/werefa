import type { OnModuleInit } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import { BusinessService } from '../business/business.service';
import { JobQueueService } from './job-queue.service';
import type { JobDefinition, JobPayload } from './job-queue.service';

/**
 * Periodic sweep performing automatic resumes for paused businesses whose
 * scheduled resume time has arrived (REQ-153/154/155/156). Runs every minute at
 * platform scope with the System actor (REQ-044).
 *
 *  - Subscription active (REQ-153): unpause + record BUSINESS_AUTO_RESUME.
 *  - Subscription not active (REQ-154): keep paused + record the denied event;
 *    the recorded event is never interpreted as availability.
 *  - Indefinite pauses (no resume date) are never auto-resumed (REQ-156).
 *  - A renewal after the pause period ended reopens bookings at the next sweep
 *    (REQ-155).
 *
 * REQ-158 (resume checks current schedule/availability) belongs to the schedule
 * domain — a documented seam for the schedule module (see docs 03).
 */
export const BUSINESS_SCHEDULED_RESUME = 'business-scheduled-resume';
const EVERY_MINUTE = '* * * * *';

@Injectable()
export class ScheduledResumeJob implements OnModuleInit {
  private readonly logger = new Logger(ScheduledResumeJob.name);

  constructor(
    private readonly jobs: JobQueueService,
    private readonly businesses: BusinessService,
  ) {}

  onModuleInit(): void {
    const definition: JobDefinition<JobPayload> = {
      name: BUSINESS_SCHEDULED_RESUME,
      maxAttempts: 3,
      backoffMs: 30_000,
      repeatCron: EVERY_MINUTE,
      handler: async () => {
        const { resumed, denied } = await this.businesses.autoResumeDueBusinesses();
        if (resumed > 0 || denied > 0) {
          this.logger.log(`Scheduled-resume sweep: resumed=${resumed} denied=${denied}`);
        }
      },
    };
    this.jobs.register(definition);
  }
}
