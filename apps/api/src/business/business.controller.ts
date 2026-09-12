import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Role } from '@werefa/shared';
import { Actor } from '../common/decorators/actor.decorator';
import { RolesExact } from '../common/decorators/roles.decorator';
import { SessionGuard } from '../common/guards/session.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import type { ActorContext } from '../common/context/actor-context';
import { BusinessService } from './business.service';
import { BusinessSerializer, type BusinessDetailDto } from './business.serializer';
import { PrepaymentConfigService } from './prepayment-config.service';
import type { PrepaymentConfigDto } from './prepayment-input';

/**
 * Owner business-management endpoints (Prompt 09, Domain 2 TENANT + Domain 14
 * PAUSE + Domain 19 PUB-PAGE). Owner-only; each business-scoped route is
 * additionally gated by the TenantGuard (URL businessId ∈ actor.ownedBusinessIds).
 */
@Controller('/api/v1/businesses')
@UseGuards(SessionGuard, RolesGuard)
@RolesExact(Role.Owner)
export class BusinessController {
  constructor(
    private readonly businesses: BusinessService,
    private readonly serializer: BusinessSerializer,
    private readonly prepayment: PrepaymentConfigService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Actor() actor: ActorContext,
    @Body() body: unknown,
  ): Promise<{ business: BusinessDetailDto }> {
    const { business } = await this.businesses.create(actor, body);
    return { business: this.serializer.ownerView(business) };
  }

  @Get()
  async list(@Actor() actor: ActorContext): Promise<{ businesses: BusinessDetailDto[] }> {
    const owned = await this.businesses.listOwned(actor);
    return { businesses: owned.map((b) => this.serializer.ownerView(b)) };
  }

  @Get(':businessId')
  @UseGuards(TenantGuard)
  async get(
    @Actor() actor: ActorContext,
    @Param('businessId') businessId: string,
  ): Promise<{ business: BusinessDetailDto }> {
    const business = await this.businesses.getOwned(actor, businessId);
    return { business: this.serializer.ownerView(business) };
  }

  @Patch(':businessId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(TenantGuard)
  async update(
    @Actor() actor: ActorContext,
    @Param('businessId') businessId: string,
    @Body() body: unknown,
  ): Promise<{ business: BusinessDetailDto }> {
    const business = await this.businesses.update(actor, businessId, body);
    return { business: this.serializer.ownerView(business) };
  }

  @Post(':businessId/pause')
  @HttpCode(HttpStatus.OK)
  @UseGuards(TenantGuard)
  async pause(
    @Actor() actor: ActorContext,
    @Param('businessId') businessId: string,
    @Body() body: unknown,
  ): Promise<{ business: BusinessDetailDto }> {
    const business = await this.businesses.pause(actor, businessId, body);
    return { business: this.serializer.ownerView(business) };
  }

  @Post(':businessId/resume')
  @HttpCode(HttpStatus.OK)
  @UseGuards(TenantGuard)
  async resume(
    @Actor() actor: ActorContext,
    @Param('businessId') businessId: string,
  ): Promise<{ business: BusinessDetailDto }> {
    const business = await this.businesses.resume(actor, businessId);
    return { business: this.serializer.ownerView(business) };
  }

  @Post(':businessId/deactivate')
  @HttpCode(HttpStatus.OK)
  @UseGuards(TenantGuard)
  async deactivate(
    @Actor() actor: ActorContext,
    @Param('businessId') businessId: string,
  ): Promise<{ business: BusinessDetailDto }> {
    const business = await this.businesses.deactivate(actor, businessId);
    return { business: this.serializer.ownerView(business) };
  }

  @Post(':businessId/reactivate')
  @HttpCode(HttpStatus.OK)
  @UseGuards(TenantGuard)
  async reactivate(
    @Actor() actor: ActorContext,
    @Param('businessId') businessId: string,
  ): Promise<{ business: BusinessDetailDto }> {
    const business = await this.businesses.reactivate(actor, businessId);
    return { business: this.serializer.ownerView(business) };
  }

  /** Remember the selected business for dashboard context (REQ-016/019/021). */
  @Post(':businessId/select')
  @HttpCode(HttpStatus.OK)
  @UseGuards(TenantGuard)
  async select(
    @Actor() actor: ActorContext,
    @Param('businessId') businessId: string,
  ): Promise<{ activeBusinessId: string }> {
    return this.businesses.selectContext(actor, businessId);
  }

  /** Read own business prepayment configuration (REQ-110/111). */
  @Get(':businessId/prepayment-config')
  @UseGuards(TenantGuard)
  async getPrepaymentConfig(
    @Actor() actor: ActorContext,
    @Param('businessId') businessId: string,
  ): Promise<{ prepayment: PrepaymentConfigDto }> {
    const prepayment = await this.prepayment.getForOwner(actor.userId, businessId);
    return { prepayment };
  }

  /** Update own business prepayment configuration (REQ-110/111). */
  @Patch(':businessId/prepayment-config')
  @HttpCode(HttpStatus.OK)
  @UseGuards(TenantGuard)
  async updatePrepaymentConfig(
    @Actor() actor: ActorContext,
    @Param('businessId') businessId: string,
    @Body() body: unknown,
  ): Promise<{ prepayment: PrepaymentConfigDto }> {
    const prepayment = await this.prepayment.updateForOwner(actor.userId, businessId, body);
    return { prepayment };
  }

  @Post(':businessId/logo')
  @HttpCode(HttpStatus.OK)
  @UseGuards(TenantGuard)
  @UseInterceptors(FileInterceptor('file'))
  async uploadLogo(
    @Actor() actor: ActorContext,
    @Param('businessId') businessId: string,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<{ business: BusinessDetailDto }> {
    const business = await this.businesses.uploadMedia(
      actor,
      businessId,
      'LOGO',
      file ? { buffer: file.buffer, mimetype: file.mimetype, size: file.size } : undefined,
    );
    return { business: this.serializer.ownerView(business) };
  }

  @Post(':businessId/cover')
  @HttpCode(HttpStatus.OK)
  @UseGuards(TenantGuard)
  @UseInterceptors(FileInterceptor('file'))
  async uploadCover(
    @Actor() actor: ActorContext,
    @Param('businessId') businessId: string,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<{ business: BusinessDetailDto }> {
    const business = await this.businesses.uploadMedia(
      actor,
      businessId,
      'COVER',
      file ? { buffer: file.buffer, mimetype: file.mimetype, size: file.size } : undefined,
    );
    return { business: this.serializer.ownerView(business) };
  }
}
