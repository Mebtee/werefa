import { Module } from '@nestjs/common';
import { AppConfig } from '../config/app-config';
import { CONFIG } from '../config/config.constants';
import { DomainServicesModule } from '../domain/domain-services.module';
import { AUTH_CONTEXT_RESOLVER, AuthContextResolver, DeniedAuthContextResolver, TestAuthContextResolver } from './auth/auth-context';
import { PublicController } from './public/public.controller';
import { CustomerController } from './customer/customer.controller';
import { OwnerBusinessController } from './owner/business.controller';
import { OwnerCatalogController } from './owner/catalog.controller';
import { OwnerScheduleController } from './owner/schedule.controller';
import { OwnerBookingController } from './owner/booking.controller';

/**
 * HTTP API & contract layer (Prompt 42).
 *
 * Controllers are thin: they validate a class-validator DTO, resolve the
 * explicit ActorContext, call an application service and project the result.
 * Request bodies are versioned under the `/api/v1` prefix (Prompt 39).
 *
 * Authentication is deferred — the resolver provider is production-gated, so
 * owner routes fail with UNAUTHENTICATED outside of test/dev AUTH_TEST_ENABLED.
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
  providers: [
    {
      provide: AUTH_CONTEXT_RESOLVER,
      inject: [CONFIG],
      useFactory: (config: AppConfig): AuthContextResolver => {
        if (config.authTestEnabled && config.nodeEnv !== 'production') {
          return new TestAuthContextResolver(config);
        }
        return new DeniedAuthContextResolver();
      },
    },
  ],
  exports: [AUTH_CONTEXT_RESOLVER],
})
export class ApiModule {}