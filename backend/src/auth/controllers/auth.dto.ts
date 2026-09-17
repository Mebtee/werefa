import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsISO8601, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'owner@werefa.app' })
  @IsEmail()
  @MaxLength(320)
  email: string;

  @ApiProperty({ example: '••••••••' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  currentPassword: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  newPassword: string;
}

export class RecoveryRequestDto {
  @ApiProperty({ example: 'superadmin@werefa.app' })
  @IsEmail()
  @MaxLength(320)
  email: string;
}

export class RecoveryConfirmDto {
  @ApiProperty({ example: 'superadmin@werefa.app' })
  @IsEmail()
  @MaxLength(320)
  email: string;

  @ApiProperty({ example: '429380' })
  @IsString()
  @MinLength(6)
  @MaxLength(8)
  code: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  newPassword: string;
}

export class CreateAdminDto {
  @ApiProperty({ example: 'admin2@werefa.app' })
  @IsEmail()
  @MaxLength(320)
  email: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password: string;

  @ApiPropertyOptional({ example: 'admin2-recovery@werefa.app' })
  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  recoveryEmail?: string;
}

export class ResetAdminPasswordDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  newPassword: string;
}

export class AdminIdParamDto {
  @ApiProperty({ example: 'uuid' })
  @IsUUID('4')
  id: string;
}

export class DeleteSecurityHistoryDto {
  @ApiProperty({ example: '2025-09-16T00:00:00.000Z', description: 'Delete security events strictly older than this instant.' })
  @IsISO8601()
  olderThan: string;
}