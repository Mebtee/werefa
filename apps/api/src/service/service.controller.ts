import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@werefa/shared';
import { Actor } from '../common/decorators/actor.decorator';
import { RolesExact } from '../common/decorators/roles.decorator';
import { SessionGuard } from '../common/guards/session.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { TenantGuard } from '../common/guards/tenant.guard';
import type { ActorContext } from '../common/context/actor-context';
import { ServiceService } from './service.service';
import {
  ServiceSerializer,
  type ServiceChildDto,
  type ServiceDetailDto,
} from './service.serializer';

/**
 * Owner service-catalog endpoints (Prompt 10, Domain 8 — Services/Pricing).
 *
 * Owner-only via `@RolesExact(Role.Owner)` — Admins/Super Admins do NOT
 * inherit business-owner service capabilities by hierarchy (REQ "Admin cannot
 * perform owner-only operations"). Every route carries a `businessId` URL
 * param validated by the TenantGuard (∈ actor.ownedBusinessIds); service sub-
 * ids are always re-scoped by businessId in the service layer + RLS.
 */
@Controller('/api/v1/businesses/:businessId/services')
@UseGuards(SessionGuard, RolesGuard, TenantGuard)
@RolesExact(Role.Owner)
export class ServiceController {
  constructor(
    private readonly services: ServiceService,
    private readonly serializer: ServiceSerializer,
  ) {}

  // --- Service -----------------------------------------------------------------

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Actor() actor: ActorContext,
    @Param('businessId') businessId: string,
    @Body() body: unknown,
  ): Promise<{ service: ServiceDetailDto }> {
    const row = await this.services.create(actor, businessId, body);
    return { service: this.serializer.ownerView(row) };
  }

  @Get()
  async list(
    @Actor() actor: ActorContext,
    @Param('businessId') businessId: string,
  ): Promise<{ services: ServiceDetailDto[] }> {
    const rows = await this.services.list(actor, businessId);
    return { services: rows.map((r) => this.serializer.ownerView(r)) };
  }

  @Get(':serviceId')
  async get(
    @Actor() actor: ActorContext,
    @Param('businessId') businessId: string,
    @Param('serviceId') serviceId: string,
  ): Promise<{ service: ServiceDetailDto }> {
    const row = await this.services.get(actor, businessId, serviceId);
    return { service: this.serializer.ownerView(row) };
  }

  @Patch(':serviceId')
  @HttpCode(HttpStatus.OK)
  async update(
    @Actor() actor: ActorContext,
    @Param('businessId') businessId: string,
    @Param('serviceId') serviceId: string,
    @Body() body: unknown,
  ): Promise<{ service: ServiceDetailDto }> {
    const row = await this.services.update(actor, businessId, serviceId, body);
    return { service: this.serializer.ownerView(row) };
  }

  @Post(':serviceId/deactivate')
  @HttpCode(HttpStatus.OK)
  async deactivate(
    @Actor() actor: ActorContext,
    @Param('businessId') businessId: string,
    @Param('serviceId') serviceId: string,
  ): Promise<{ service: ServiceDetailDto }> {
    const row = await this.services.deactivate(actor, businessId, serviceId);
    return { service: this.serializer.ownerView(row) };
  }

  @Post(':serviceId/reactivate')
  @HttpCode(HttpStatus.OK)
  async reactivate(
    @Actor() actor: ActorContext,
    @Param('businessId') businessId: string,
    @Param('serviceId') serviceId: string,
  ): Promise<{ service: ServiceDetailDto }> {
    const row = await this.services.reactivate(actor, businessId, serviceId);
    return { service: this.serializer.ownerView(row) };
  }

  @Delete(':serviceId')
  @HttpCode(HttpStatus.OK)
  async remove(
    @Actor() actor: ActorContext,
    @Param('businessId') businessId: string,
    @Param('serviceId') serviceId: string,
  ): Promise<{ service: ServiceDetailDto }> {
    const row = await this.services.remove(actor, businessId, serviceId);
    return { service: this.serializer.ownerView(row) };
  }

  // --- Variations (REQ-072) ------------------------------------------------------

  @Get(':serviceId/variations')
  async listVariations(
    @Actor() actor: ActorContext,
    @Param('businessId') businessId: string,
    @Param('serviceId') serviceId: string,
  ): Promise<{ variations: ServiceChildDto[] }> {
    const row = await this.services.get(actor, businessId, serviceId);
    return { variations: row.variations.map((v) => this.serializer.variationView(v)) };
  }

  @Post(':serviceId/variations')
  @HttpCode(HttpStatus.CREATED)
  async createVariation(
    @Actor() actor: ActorContext,
    @Param('businessId') businessId: string,
    @Param('serviceId') serviceId: string,
    @Body() body: unknown,
  ): Promise<{ variation: ServiceChildDto }> {
    const variation = await this.services.createVariation(actor, businessId, serviceId, body);
    return { variation: this.serializer.variationView(variation) };
  }

  @Patch(':serviceId/variations/:variationId')
  @HttpCode(HttpStatus.OK)
  async updateVariation(
    @Actor() actor: ActorContext,
    @Param('businessId') businessId: string,
    @Param('serviceId') serviceId: string,
    @Param('variationId') variationId: string,
    @Body() body: unknown,
  ): Promise<{ variation: ServiceChildDto }> {
    const variation = await this.services.updateVariation(
      actor,
      businessId,
      serviceId,
      variationId,
      body,
    );
    return { variation: this.serializer.variationView(variation) };
  }

  @Delete(':serviceId/variations/:variationId')
  @HttpCode(HttpStatus.OK)
  async deleteVariation(
    @Actor() actor: ActorContext,
    @Param('businessId') businessId: string,
    @Param('serviceId') serviceId: string,
    @Param('variationId') variationId: string,
  ): Promise<{ variation: ServiceChildDto }> {
    const variation = await this.services.deleteVariation(
      actor,
      businessId,
      serviceId,
      variationId,
    );
    return { variation: this.serializer.variationView(variation) };
  }

  // --- Add-ons (REQ-073) ----------------------------------------------------------

  @Get(':serviceId/add-ons')
  async listAddOns(
    @Actor() actor: ActorContext,
    @Param('businessId') businessId: string,
    @Param('serviceId') serviceId: string,
  ): Promise<{ addOns: ServiceChildDto[] }> {
    const row = await this.services.get(actor, businessId, serviceId);
    return { addOns: row.addOns.map((a) => this.serializer.addOnView(a)) };
  }

  @Post(':serviceId/add-ons')
  @HttpCode(HttpStatus.CREATED)
  async createAddOn(
    @Actor() actor: ActorContext,
    @Param('businessId') businessId: string,
    @Param('serviceId') serviceId: string,
    @Body() body: unknown,
  ): Promise<{ addOn: ServiceChildDto }> {
    const addOn = await this.services.createAddOn(actor, businessId, serviceId, body);
    return { addOn: this.serializer.addOnView(addOn) };
  }

  @Patch(':serviceId/add-ons/:addOnId')
  @HttpCode(HttpStatus.OK)
  async updateAddOn(
    @Actor() actor: ActorContext,
    @Param('businessId') businessId: string,
    @Param('serviceId') serviceId: string,
    @Param('addOnId') addOnId: string,
    @Body() body: unknown,
  ): Promise<{ addOn: ServiceChildDto }> {
    const addOn = await this.services.updateAddOn(actor, businessId, serviceId, addOnId, body);
    return { addOn: this.serializer.addOnView(addOn) };
  }

  @Delete(':serviceId/add-ons/:addOnId')
  @HttpCode(HttpStatus.OK)
  async deleteAddOn(
    @Actor() actor: ActorContext,
    @Param('businessId') businessId: string,
    @Param('serviceId') serviceId: string,
    @Param('addOnId') addOnId: string,
  ): Promise<{ addOn: ServiceChildDto }> {
    const addOn = await this.services.deleteAddOn(actor, businessId, serviceId, addOnId);
    return { addOn: this.serializer.addOnView(addOn) };
  }
}
