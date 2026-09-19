import { Body, Controller, Get, HttpCode, Inject, NotFoundException, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiOkResponse, ApiCreatedResponse, ApiTags } from '@nestjs/swagger';
import { CatalogService } from '../../domain/services/catalog.service';
import { ActorContext } from '../../domain/authorization/actor-context';
import { Actor, ApiAuthGuard } from '../auth/api-auth.guard';
import { OwnerServiceView, PublicServiceVariantView, ownerServicesProjection } from '../dto/projections';
import { BusinessIdParamDto, CreateServicePayload, CreateVariantPayload, ServiceIdParamDto, UpdateServicePayload } from '../dto/payloads';

/**
 * Owner service-catalog management (Prompt 42 §7; REQ-069 … REQ-081).
 * No hard deletes — deactivation only (REQ-077/078).
 */
@ApiTags('owner · catalog')
@Controller('owner/businesses')
@UseGuards(ApiAuthGuard)
export class OwnerCatalogController {
  constructor(@Inject(CatalogService) private readonly catalogService: CatalogService) {}

  private async single(actor: ActorContext, businessId: string, serviceId: string): Promise<OwnerServiceView> {
    const service = await this.catalogService.getServiceForOwner(actor, businessId, serviceId);
    if (!service) throw new NotFoundException('Service not found.');
    return ownerServicesProjection([service])[0];
  }

  @Get(':businessId/services')
  @ApiOperation({ summary: 'List all services incl. inactive with variations/add-ons (owner).' })
  @ApiOkResponse({ type: OwnerServiceView, isArray: true })
  async list(@Actor() actor: ActorContext, @Param() params: BusinessIdParamDto): Promise<OwnerServiceView[]> {
    const services = await this.catalogService.listServicesForOwner(actor, params.businessId);
    return ownerServicesProjection(services);
  }

  @Post(':businessId/services')
  @ApiOperation({ summary: 'Create a service.' })
  @ApiCreatedResponse({ type: OwnerServiceView })
  async create(
    @Actor() actor: ActorContext,
    @Param() params: BusinessIdParamDto,
    @Body() payload: CreateServicePayload,
  ): Promise<OwnerServiceView> {
    const created = await this.catalogService.createService(actor, params.businessId, {
      name: payload.name,
      basePriceMinor: BigInt(payload.basePriceMinor),
      baseDurationMinutes: payload.baseDurationMinutes,
    });
    return this.single(actor, params.businessId, created.id);
  }

  @Patch(':businessId/services/:serviceId')
  @ApiOperation({ summary: 'Update a service (name, price, duration).' })
  @ApiOkResponse({ type: OwnerServiceView })
  async update(
    @Actor() actor: ActorContext,
    @Param() params: ServiceIdParamDto,
    @Body() payload: UpdateServicePayload,
  ): Promise<OwnerServiceView> {
    await this.catalogService.updateService(actor, params.businessId, params.serviceId, {
      name: payload.name,
      basePriceMinor: payload.basePriceMinor == null ? undefined : BigInt(payload.basePriceMinor),
      baseDurationMinutes: payload.baseDurationMinutes,
    });
    return this.single(actor, params.businessId, params.serviceId);
  }

  @Post(':businessId/services/:serviceId/variations')
  @ApiOperation({ summary: 'Create a service variation.' })
  @ApiCreatedResponse({ type: PublicServiceVariantView })
  async createVariation(
    @Actor() actor: ActorContext,
    @Param() params: ServiceIdParamDto,
    @Body() payload: CreateVariantPayload,
  ): Promise<PublicServiceVariantView> {
    const created = await this.catalogService.createVariation(actor, params.businessId, params.serviceId, {
      name: payload.name,
      priceDeltaMinor: BigInt(payload.priceDeltaMinor),
      durationDeltaMinutes: payload.durationDeltaMinutes,
    });
    return { id: created.id, name: created.name, priceDeltaMinor: Number(created.priceDeltaMinor), durationDeltaMinutes: created.durationDeltaMinutes };
  }

  @Post(':businessId/services/:serviceId/addons')
  @ApiOperation({ summary: 'Create a service add-on.' })
  @ApiCreatedResponse({ type: PublicServiceVariantView })
  async createAddOn(
    @Actor() actor: ActorContext,
    @Param() params: ServiceIdParamDto,
    @Body() payload: CreateVariantPayload,
  ): Promise<PublicServiceVariantView> {
    const created = await this.catalogService.createAddOn(actor, params.businessId, params.serviceId, {
      name: payload.name,
      priceDeltaMinor: BigInt(payload.priceDeltaMinor),
      durationDeltaMinutes: payload.durationDeltaMinutes,
    });
    return { id: created.id, name: created.name, priceDeltaMinor: Number(created.priceDeltaMinor), durationDeltaMinutes: created.durationDeltaMinutes };
  }

  @Post(':businessId/services/:serviceId/deactivate')
  @ApiOperation({ summary: 'Deactivate a service (unavailable for new bookings).' })
  @ApiOkResponse({ type: OwnerServiceView })
  @HttpCode(200)
  async deactivate(@Actor() actor: ActorContext, @Param() params: ServiceIdParamDto): Promise<OwnerServiceView> {
    await this.catalogService.deactivateService(actor, params.businessId, params.serviceId);
    return this.single(actor, params.businessId, params.serviceId);
  }

  @Post(':businessId/services/:serviceId/reactivate')
  @ApiOperation({ summary: 'Reactivate a deactivated service.' })
  @ApiOkResponse({ type: OwnerServiceView })
  @HttpCode(200)
  async reactivate(@Actor() actor: ActorContext, @Param() params: ServiceIdParamDto): Promise<OwnerServiceView> {
    await this.catalogService.reactivateService(actor, params.businessId, params.serviceId);
    return this.single(actor, params.businessId, params.serviceId);
  }
}