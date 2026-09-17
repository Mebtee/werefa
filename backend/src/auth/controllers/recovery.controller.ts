import { Body, Controller, Post, HttpCode, HttpStatus, Inject, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request as ExpressRequest } from 'express';
import { RecoveryService } from '../../domain/services/recovery.service';
import { clientInfoFrom } from '../client-info';
import { RecoveryConfirmDto, RecoveryRequestDto } from './auth.dto';

/**
 * Super Admin emergency recovery (Prompt 43; REQ-198–200).
 *
 * Request is always successful-looking (generic 200) so the endpoint cannot
 * enumerate accounts. Confirm resets the password, revokes every session and
 * clears any lockout; failures collapse to a single generic error.
 */
@ApiTags('auth · recovery')
@Controller('auth/recovery')
export class RecoveryController {
  constructor(@Inject(RecoveryService) private readonly recoveryService: RecoveryService) {}

  @Post('request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request a one-time recovery code (always generic 200).' })
  async request(@Body() dto: RecoveryRequestDto, @Req() req: ExpressRequest) {
    await this.recoveryService.requestCode({
      email: dto.email,
      client: clientInfoFrom(req),
    });
    return { message: 'If the account exists, a recovery code has been sent to its recovery email.' };
  }

  @Post('confirm')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Confirm the code and immediately reset the password (revokes all sessions).' })
  async confirm(@Body() dto: RecoveryConfirmDto, @Req() req: ExpressRequest): Promise<void> {
    await this.recoveryService.confirmReset({
      email: dto.email,
      code: dto.code,
      newPassword: dto.newPassword,
      client: clientInfoFrom(req),
    });
  }
}