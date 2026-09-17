import { Module } from '@nestjs/common';
import { DomainServicesModule } from '../domain/domain-services.module';
import { AUTH_CONTEXT_RESOLVER_PROVIDER } from './auth/auth-context';
import { PublicController } from './public/public.controller';
import { CustomerController } from './customer/customer.controller';
import { OwnerBusinessController } from './owner/business.controller';
import { OwnerCatalogController } from './owner/catalog.controller';
import { OwnerScheduleController } from './owner/schedule.controller';
import { OwnerBookingController } from './owner/booking.controller';

/**
 * HTTP API & contract layer (Prompt 42/43).
 *
 * Controllers are thin: they validate a class-validator DTO, resolve the
 * explicit ActorContext, call an application service and project the result.
 * Request bodies are versioned under the `/api/v1` prefix (Prompt 39).
 *
 * The AUTH_CONTEXT_RESOLVER is supplied in this module's own scope (same
 * factory as AuthModule — both are stateless): production resolves real
 * httpOnly-session actors; test/dev with AUTH_TEST_ENABLED opt into the
 * explicit X-Actor header bridge.
 */
@Module({
  imports: [DomainServicesModule],
  controllers: [
    PublicController,
    CustomerController,
    OwnerBusinessController,
    OwnerCatalogController,
    OwnerScheduleController,
    OwnerBookingController,
  ],
  providers: [AUTH_CONTEXT_RESOLVER_PROVIDER],
})
export class ApiModule {}