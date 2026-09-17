import { Module } from '@nestjs/common';
import { DomainServicesModule } from '../domain/domain-services.module';
import { AuthController } from './controllers/auth.controller';
import { RecoveryController } from './controllers/recovery.controller';
import { AdminAuthController } from './controllers/admin.controller';
import { AUTH_CONTEXT_RESOLVER, AUTH_CONTEXT_RESOLVER_PROVIDER } from '../api/auth/auth-context';

/**
 * Auth module (Prompt 43).
 *
 * Owns the production authentication boundary: it supplies the session-cookie
 * actor resolver (test bridge only when AUTH_TEST_ENABLED + non-production)
 * and the auth/recovery/admin HTTP controllers. All persistence lives under
 * the domain modules.
 */
@Module({
  imports: [DomainServicesModule],
  controllers: [AuthController, RecoveryController, AdminAuthController],
  providers: [AUTH_CONTEXT_RESOLVER_PROVIDER],
  exports: [AUTH_CONTEXT_RESOLVER],
})
export class AuthModule {}