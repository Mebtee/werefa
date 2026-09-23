import { Body, Controller, Get, HttpCode, Inject, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { BusinessService } from '../../domain/services/business.service';
import { CatalogService } from '../../domain/services/catalog.service';
import { AvailabilityService } from '../../domain/services/availability.service';
import { ScheduleService } from '../../domain/services/schedule.service';
import { TelegramConnectionService } from '../../domain/notifications/telegram-connection.service';
import {
  PublicAvailabilityView,
  PublicBusinessView,
  PublicScheduleView,
  PublicServiceView,
  TelegramConnectionView,
  publicBusinessProjection,
  publicScheduleProjection,
  publicServicesProjection,
  telegramConnectProjection,
} from '../dto/projections';
import { AvailabilityQuery, AvailabilityQueryBody, SlugParamsDto, TelegramCustomerConnectPayload } from '../dto/payloads';

/**
 * Public, unauthenticated business page contract (spec §13, §25.3; Prompt 42 §6).
 * Only publish-safe projections are returned; the page stays visible for
 * paused/deactivated businesses (bookings are gated at creation).
 */
@ApiTags('public')
@Controller('public/businesses')
export class PublicController {
  constructor(
    @Inject(BusinessService) private readonly businessService: BusinessService,
    @Inject(CatalogService) private readonly catalogService: CatalogService,
    @Inject(AvailabilityService) private readonly availabilityService: AvailabilityService,
    @Inject(ScheduleService) private readonly scheduleService: ScheduleService,
    @Inject(TelegramConnectionService) private readonly telegramConnections: TelegramConnectionService,
  ) {}

  private async requireBusiness(slug: string) {
    const profile = await this.businessService.getPublicProfile(slug);
    if (!profile) throw new NotFoundException('Business not found.');
    return profile;
  }

  @Get(':slug')
  @ApiOperation({ summary: 'Public business profile (visible even when paused/deactivated).' })
  @ApiOkResponse({ type: PublicBusinessView })
  @HttpCode(200)
  async business(@Param() params: SlugParamsDto): Promise<PublicBusinessView> {
    const profile = await this.requireBusiness(params.slug);
    return publicBusinessProjection(profile);
  }

  @Get(':slug/services')
  @ApiOperation({ summary: 'Active services with active variations/add-ons (REQ-079).' })
  @ApiOkResponse({ type: PublicServiceView, isArray: true })
  async services(@Param() params: SlugParamsDto): Promise<PublicServiceView[]> {
    const profile = await this.requireBusiness(params.slug);
    return publicServicesProjection(await this.catalogService.listActiveServices(profile.business.id));
  }

  @Get(':slug/schedule')
  @ApiOperation({ summary: 'Publish-safe weekly schedule (working periods, blocks, special dates).' })
  @ApiOkResponse({ type: PublicScheduleView })
  async schedule(@Param() params: SlugParamsDto): Promise<PublicScheduleView> {
    const profile = await this.requireBusiness(params.slug);
    const version = await this.scheduleService.getActiveVersion(profile.business.id);
    if (!version) throw new NotFoundException('No active schedule version.');
    return publicScheduleProjection(version);
  }

  @Get(':slug/availability')
  @ApiOperation({
    summary:
      'Available slot starts for a date (read-only, no reservation). Duration/price computed from the selected combination.',
  })
  @ApiOkResponse({ type: PublicAvailabilityView })
  async availability(@Param() params: SlugParamsDto, @Query() query: AvailabilityQuery): Promise<PublicAvailabilityView> {
    return this.buildAvailability(params.slug, query.date, [
      { serviceId: query.serviceId, variationIds: query.variationIds, addOnIds: query.addOnIds },
    ]);
  }

  @Post(':slug/availability')
  @ApiOperation({
    summary:
      'Available slot starts for a date and a multi-service selection (REQ-070, read-only). Duration/price computed for the whole appointment.',
  })
  @ApiOkResponse({ type: PublicAvailabilityView })
  @HttpCode(200)
  async availabilityForSelections(
    @Param() params: SlugParamsDto,
    @Body() body: AvailabilityQueryBody,
  ): Promise<PublicAvailabilityView> {
    return this.buildAvailability(
      params.slug,
      body.date,
      body.selections.map((s) => ({
        serviceId: s.serviceId,
        variationIds: s.variationId ? [s.variationId] : [],
        addOnIds: s.addOnIds,
      })),
    );
  }

  @Post(':slug/telegram/connect')
  @ApiOperation({
    summary:
      'Connect this business + phone to Telegram. Already-connected customers get `{status:"connected"}`; otherwise a one-time 10-minute deep link is returned (REQ-056).',
  })
  @ApiOkResponse({ type: TelegramConnectionView })
  @HttpCode(200)
  async telegramConnect(
    @Param() params: SlugParamsDto,
    @Body() payload: TelegramCustomerConnectPayload,
  ): Promise<TelegramConnectionView> {
    await this.requireBusiness(params.slug);
    const result = await this.telegramConnections.connectCustomer(params.slug, payload.phone);
    return telegramConnectProjection(result);
  }

  private async buildAvailability(
    slug: string,
    date: string,
    selections: { serviceId: string; variationIds?: string[]; addOnIds?: string[] }[],
  ): Promise<PublicAvailabilityView> {
    const profile = await this.requireBusiness(slug);
    const { totalPriceMinor, totalDurationMinutes } = await this.catalogService.validateCombinations(
      profile.business.id,
      selections,
    );
    const slots = await this.availabilityService.getSlotsForDay(profile.business.id, {
      dateKey: date,
      durationMinutes: totalDurationMinutes,
    });
    return {
      date,
      slots: slots.map((s) => ({ startAt: s.startAt.toISOString(), endAt: s.endAt.toISOString() })),
      computedDurationMinutes: totalDurationMinutes,
      computedTotalPriceMinor: Number(totalPriceMinor),
    };
  }
}