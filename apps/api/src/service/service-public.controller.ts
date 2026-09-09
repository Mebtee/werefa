import { Controller, Get, Param } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { ServiceService } from './service.service';
import { ServiceSerializer, type PublicServiceDto } from './service.serializer';

/**
 * Public service catalog (REQ-214 foundation, Prompt 10).
 *
 * Unauthenticated, SELECT-only (PUBLIC RLS scope): returns the business's
 * ACTIVE services with their ACTIVE variations/add-ons (REQ-079). The payload
 * is a curated subset — name/price/duration/variations/add-ons only; no
 * business_id, lifecycle flags, timestamps or any internal/owner data. No
 * booking submission flow is present (later booking module).
 */
@Controller('/api/v1/public/businesses')
@Public()
export class ServicePublicController {
  constructor(
    private readonly services: ServiceService,
    private readonly serializer: ServiceSerializer,
  ) {}

  @Get(':slug/services')
  async catalog(@Param('slug') slug: string): Promise<{ services: PublicServiceDto[] }> {
    const rows = await this.services.listPublic(slug);
    return { services: rows.map((r) => this.serializer.publicView(r)) };
  }
}
