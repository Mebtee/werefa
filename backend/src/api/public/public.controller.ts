import { Controller, Get, HttpCode, Inject, NotFoundException, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { BusinessService } from '../../domain/services/business.service';
import { CatalogService } from '../../domain/services/catalog.service';
import { AvailabilityService } from '../../domain/services/availability.service';
import {
  PublicAvailabilityView,
  PublicBusinessView,
  PublicServiceView,
  publicBusinessProjection,
  publicServicesProjection,
} from '../dto/projections';
import { AvailabilityQuery, SlugParamsDto } from '../dto/payloads';

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

  @Get(':slug/availability')
  @ApiOperation({
    summary:
      'Available slot starts for a date (read-only, no reservation). Duration/price computed from the selected combination.',
  })
  @ApiOkResponse({ type: PublicAvailabilityView })
  async availability(@Param() params: SlugParamsDto, @Query() query: AvailabilityQuery): Promise<PublicAvailabilityView> {
    const profile = await this.requireBusiness(params.slug);
    const { totalPriceMinor, totalDurationMinutes } = await this.catalogService.validateCombination(profile.business.id, {
      serviceId: query.serviceId,
      variationIds: query.variationIds,
      addOnIds: query.addOnIds,
    });
    const slots = await this.availabilityService.getSlotsForDay(profile.business.id, {
      dateKey: query.date,
      durationMinutes: totalDurationMinutes,
    });
    return {
      date: query.date,
      slots: slots.map((s) => ({ startAt: s.startAt.toISOString(), endAt: s.endAt.toISOString() })),
      computedDurationMinutes: totalDurationMinutes,
      computedTotalPriceMinor: Number(totalPriceMinor),
    };
  }
}