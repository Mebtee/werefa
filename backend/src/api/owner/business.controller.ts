import { Body, Controller, Get, HttpCode, HttpException, HttpStatus, Inject, Param, Patch, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiConsumes, ApiOperation, ApiOkResponse, ApiCreatedResponse, ApiTags } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { BusinessService } from '../../domain/services/business.service';
import { SubscriptionBillingService } from '../../domain/services/subscription-billing.service';
import { ActorContext } from '../../domain/authorization/actor-context';
import { Actor, ApiAuthGuard } from '../auth/api-auth.guard';
import { isAllowedProofMimeType, PROOF_MAX_BYTES } from '../../domain/lib/proof-file';
import {
  OwnerBusinessView,
  OwnerSubscriptionProofView,
  OwnerSubscriptionView,
  ownerBusinessProjection,
  ownerProofProjection,
} from '../dto/projections';
import {
  BusinessIdParamDto,
  ChangeSlugPayload,
  CreateBusinessPayload,
  PausePayload,
  SubmitSubscriptionProofPayload,
  UpdateBusinessProfilePayload,
  UpdateBusinessSettingsPayload,
} from '../dto/payloads';
import { parseMultipartPayload } from '../dto/multipart-payload';

/**
 * Owner business management (Prompt 42 §6; Prompt 52 subscription §17). All
 * routes require an owner ActorContext and every businessId is authorized
 * through the TenantGuard.
 */
@ApiTags('owner · business')
@Controller('owner/businesses')
@UseGuards(ApiAuthGuard)
export class OwnerBusinessController {
  constructor(
    @Inject(BusinessService) private readonly businessService: BusinessService,
    @Inject(SubscriptionBillingService) private readonly subscriptionBilling: SubscriptionBillingService,
  ) {}

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

  @Get(':businessId/subscription')
  @ApiOperation({
    summary: 'Subscription status + proof history for the owner (REQ-141 banner / REQ-136 upload context).',
  })
  @ApiOkResponse({ type: OwnerSubscriptionView })
  async getSubscription(
    @Actor() actor: ActorContext,
    @Param() params: BusinessIdParamDto,
  ): Promise<OwnerSubscriptionView> {
    const view = await this.subscriptionBilling.getOwnerSubscriptionView(actor, params.businessId);
    return {
      status: view.subscription.status,
      trialStartedAt: isoOf(view.subscription.trialStartedAt),
      trialEndsAt: isoOf(view.subscription.trialEndsAt),
      trialGraceEndsAt: isoOf(view.subscription.trialGraceEndsAt),
      periodEndsAt: isoOf(view.subscription.periodEndsAt),
      paidGraceEndsAt: isoOf(view.subscription.paidGraceEndsAt),
      bookingsEnabled: view.bookingsEnabled,
      proofs: view.proofs.map(ownerProofProjection),
    };
  }

  @Post(':businessId/subscription/proof')
  @ApiOperation({
    summary: 'Owner uploads a subscription payment proof (image/PDF; idempotent by submissionKey, REQ-136).',
  })
  @ApiConsumes('multipart/form-data')
  @ApiCreatedResponse({ type: OwnerSubscriptionProofView })
  @UseInterceptors(subscriptionProofInterceptor())
  async submitSubscriptionProof(
    @Actor() actor: ActorContext,
    @Param() params: BusinessIdParamDto,
    @UploadedFile() proof: SubscriptionProofUploadFile | undefined,
    @Body('payload') payloadRaw: string | undefined,
  ): Promise<OwnerSubscriptionProofView> {
    const payload = await parseMultipartPayload(payloadRaw, SubmitSubscriptionProofPayload);
    const created = await this.subscriptionBilling.submitProof(actor, params.businessId, {
      submissionKey: payload.submissionKey,
      file: toSubscriptionProofInput(proof),
    });
    return ownerProofProjection(created);
  }
}

/** Uploaded `proof` file part (multer memory storage). */
interface SubscriptionProofUploadFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
}

function toSubscriptionProofInput(file: SubscriptionProofUploadFile | undefined): { bytes: Buffer; mimeType: string } {
  if (!file) throw new HttpException('A payment proof file is required.', HttpStatus.BAD_REQUEST);
  return { bytes: file.buffer, mimeType: file.mimetype };
}

/** Shared multipart setup for the `proof` field: 5 MB cap + cheap MIME pre-screen. */
function subscriptionProofInterceptor() {
  return FileInterceptor('proof', {
    storage: memoryStorage(),
    limits: { fileSize: PROOF_MAX_BYTES },
    fileFilter: subscriptionProofFileFilter,
  });
}

function subscriptionProofFileFilter(
  _req: unknown,
  file: { mimetype: string },
  callback: (error: Error | null, acceptFile: boolean) => void,
): void {
  if (!isAllowedProofMimeType(file.mimetype)) {
    callback(new HttpException('Unsupported subscription-proof file type.', HttpStatus.UNSUPPORTED_MEDIA_TYPE), false);
    return;
  }
  callback(null, true);
}

function isoOf(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}