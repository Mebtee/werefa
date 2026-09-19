import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiOkResponse, ApiCreatedResponse, ApiTags } from '@nestjs/swagger';
import { BusinessService } from '../../domain/services/business.service';
import { ActorContext } from '../../domain/authorization/actor-context';
import { Actor, ApiAuthGuard } from '../auth/api-auth.guard';
import { OwnerBusinessView, ownerBusinessProjection } from '../dto/projections';
import {
  BusinessIdParamDto,
  ChangeSlugPayload,
  CreateBusinessPayload,
  PausePayload,
  UpdateBusinessProfilePayload,
  UpdateBusinessSettingsPayload,
} from '../dto/payloads';

/**
 * Owner business management (Prompt 42 §6). All routes require an owner
 * ActorContext and every businessId is authorized through the TenantGuard.
 */
@ApiTags('owner · business')
@Controller('owner/businesses')
@UseGuards(ApiAuthGuard)
export class OwnerBusinessController {
  constructor(@Inject(BusinessService) private readonly businessService: BusinessService) {}

  @Get()
  @ApiOperation({ summary: 'List businesses owned by the caller.' })
  @ApiOkResponse({ type: OwnerBusinessView, isArray: true })
  async list(@Actor() actor: ActorContext): Promise<OwnerBusinessView[]> {
    const list = await this.businessService.listOwnedWithSettings(actor);
    return list.map((source) => ownerBusinessProjection(source));
  }

  @Post()
  @ApiOperation({ summary: 'Create a business (starts its TRIAL subscription).' })
  @ApiCreatedResponse({ type: OwnerBusinessView })
  async create(@Actor() actor: ActorContext, @Body() payload: CreateBusinessPayload): Promise<OwnerBusinessView> {
    await this.businessService.createBusiness(actor, {
      slug: payload.slug,
      categoryCode: payload.categoryCode,
      name: payload.name,
      description: payload.description,
      address: payload.address,
      phonePublic: payload.phonePublic,
      bookingIntervalMinutes: payload.bookingIntervalMinutes,
    });
    const profile = await this.businessService.listOwnedWithSettings(actor);
    const created = profile.find((p) => p.business.publicSlug === payload.slug.toLowerCase());
    if (!created) {
      throw new Error('Business was created but could not be loaded.');
    }
    return ownerBusinessProjection(created);
  }

  @Get(':businessId')
  @ApiOperation({ summary: 'Full business profile incl. settings for the owner.' })
  @ApiOkResponse({ type: OwnerBusinessView })
  async get(@Actor() actor: ActorContext, @Param() params: BusinessIdParamDto): Promise<OwnerBusinessView> {
    const profile = await this.businessService.getOwnedProfile(actor, params.businessId);
    return ownerBusinessProjection(profile);
  }

  @Patch(':businessId')
  @ApiOperation({ summary: 'Update business profile fields.' })
  @ApiOkResponse({ type: OwnerBusinessView })
  async updateProfile(
    @Actor() actor: ActorContext,
    @Param() params: BusinessIdParamDto,
    @Body() payload: UpdateBusinessProfilePayload,
  ): Promise<OwnerBusinessView> {
    await this.businessService.updateProfile(actor, params.businessId, {
      name: payload.name,
      description: payload.description,
      address: payload.address,
      phonePublic: payload.phonePublic,
      categoryCode: payload.categoryCode,
      latitude: payload.latitude,
      longitude: payload.longitude,
    });
    return ownerBusinessProjection(await this.businessService.getOwnedProfile(actor, params.businessId));
  }

  @Patch(':businessId/slug')
  @ApiOperation({ summary: 'Change the public slug (REQ-047).' })
  @ApiOkResponse({ type: OwnerBusinessView })
  async changeSlug(
    @Actor() actor: ActorContext,
    @Param() params: BusinessIdParamDto,
    @Body() payload: ChangeSlugPayload,
  ): Promise<OwnerBusinessView> {
    await this.businessService.changeSlug(actor, params.businessId, payload.publicSlug);
    return ownerBusinessProjection(await this.businessService.getOwnedProfile(actor, params.businessId));
  }

  @Patch(':businessId/settings')
  @ApiOperation({ summary: 'Update booking interval and prepayment settings.' })
  @ApiOkResponse({ type: OwnerBusinessView })
  async updateSettings(
    @Actor() actor: ActorContext,
    @Param() params: BusinessIdParamDto,
    @Body() payload: UpdateBusinessSettingsPayload,
  ): Promise<OwnerBusinessView> {
    await this.businessService.updateSettings(actor, params.businessId, {
      bookingIntervalMinutes: payload.bookingIntervalMinutes,
      prepaymentMode: payload.prepaymentMode,
      prepaymentPercent: payload.prepaymentPercent,
      prepaymentFixedMinor: payload.prepaymentFixedMinor == null ? null : BigInt(payload.prepaymentFixedMinor),
    });
    return ownerBusinessProjection(await this.businessService.getOwnedProfile(actor, params.businessId));
  }

  @Post(':businessId/pause')
  @ApiOperation({ summary: 'Pause bookings with an optional public message + reopen time (REQ-147/148/149).' })
  @ApiOkResponse({ type: OwnerBusinessView })
  @HttpCode(200)
  async pause(
    @Actor() actor: ActorContext,
    @Param() params: BusinessIdParamDto,
    @Body() payload: PausePayload,
  ): Promise<OwnerBusinessView> {
    await this.businessService.pause(actor, params.businessId, {
      pauseMessage: payload.pauseMessage ?? null,
      reopenAt: payload.reopenAt ? new Date(payload.reopenAt) : null,
    });
    return ownerBusinessProjection(await this.businessService.getOwnedProfile(actor, params.businessId));
  }

  @Post(':businessId/resume')
  @ApiOperation({ summary: 'Resume bookings (rejects when the subscription is expired).' })
  @ApiOkResponse({ type: OwnerBusinessView })
  @HttpCode(200)
  async resume(@Actor() actor: ActorContext, @Param() params: BusinessIdParamDto): Promise<OwnerBusinessView> {
    await this.businessService.resumeManual(actor, params.businessId);
    return ownerBusinessProjection(await this.businessService.getOwnedProfile(actor, params.businessId));
  }

  @Post(':businessId/deactivate')
  @ApiOperation({ summary: 'Deactivate the business: page stays visible, new bookings stop (REQ-216).' })
  @ApiOkResponse({ type: OwnerBusinessView })
  @HttpCode(200)
  async deactivate(@Actor() actor: ActorContext, @Param() params: BusinessIdParamDto): Promise<OwnerBusinessView> {
    await this.businessService.deactivate(actor, params.businessId);
    return ownerBusinessProjection(await this.businessService.getOwnedProfile(actor, params.businessId));
  }

  @Post(':businessId/reactivate')
  @ApiOperation({ summary: 'Reactivate a deactivated business (opens immediately when subscription eligible).' })
  @ApiOkResponse({ type: OwnerBusinessView })
  @HttpCode(200)
  async reactivate(@Actor() actor: ActorContext, @Param() params: BusinessIdParamDto): Promise<OwnerBusinessView> {
    await this.businessService.reactivate(actor, params.businessId);
    return ownerBusinessProjection(await this.businessService.getOwnedProfile(actor, params.businessId));
  }
}