import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { RecoveryController, SuperAdminController } from './super-admin.controller';
import {
  AdminSecurityHistoryController,
  OwnerSecurityHistoryController,
  SuperAdminSecurityHistoryController,
} from './security-history.controller';
import { SessionService } from './session.service';
import { PasswordService } from './password.service';
import { SecurityEventService } from './security-events.service';
import { AuthService } from './auth.service';
import { PasswordResetService } from './reset-token.service';
import { EmailVerificationService } from './email-verification.service';
import { RecoveryService } from './recovery.service';
import { SuperAdminService } from './super-admin.service';
import { RateLimitService } from './rate-limit.service';
import { SecurityHistoryService } from './security-history.service';

@Module({
  controllers: [
    AuthController,
    SuperAdminController,
    RecoveryController,
    OwnerSecurityHistoryController,
    AdminSecurityHistoryController,
    SuperAdminSecurityHistoryController,
  ],
  providers: [
    SessionService,
    PasswordService,
    SecurityEventService,
    AuthService,
    PasswordResetService,
    EmailVerificationService,
    RecoveryService,
    SuperAdminService,
    RateLimitService,
    SecurityHistoryService,
  ],
  exports: [SessionService, PasswordService, SecurityEventService, RateLimitService],
})
export class IamModule {}
