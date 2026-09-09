import { Controller, Get, Inject, NotFoundException, Param, Res } from '@nestjs/common';
import QRCode from 'qrcode';
import type { Response } from 'express';
import { APP_CONFIG, type AppConfig } from '../config/environment';
import { Public } from '../common/decorators/public.decorator';
import { StorageService } from '../storage/storage.service';
import { BusinessService } from './business.service';
import { BusinessSerializer, type BusinessPublicDto } from './business.serializer';

/**
 * Public business page endpoints (REQ-207..216, Prompt 09).
 *
 * Unauthenticated: the public page and its media/QR are the business's public
 * web presence and remain visible while paused (REQ-146) or even when expired
 * (REQ-134). Reads run in the PUBLIC RLS scope (SELECT-only projection).
 */
@Controller('/api/v1/public/businesses')
@Public()
export class BusinessPublicController {
  constructor(
    private readonly businesses: BusinessService,
    private readonly serializer: BusinessSerializer,
    private readonly storage: StorageService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get(':slug')
  async page(@Param('slug') slug: string): Promise<{ business: BusinessPublicDto }> {
    const business = await this.businesses.findBySlug(slug);
    return { business: this.serializer.publicView(business) };
  }

  @Get(':slug/logo')
  async logo(@Param('slug') slug: string, @Res() res: Response): Promise<void> {
    const business = await this.businesses.findBySlug(slug);
    if (!business.logoKey) throw new NotFoundException('Logo not found.');
    const data = await this.storage.get(business.logoKey);
    if (!data) throw new NotFoundException('Logo not found.');
    res.set('Content-Type', business.logoMime ?? 'image/png');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(data);
  }

  @Get(':slug/cover')
  async cover(@Param('slug') slug: string, @Res() res: Response): Promise<void> {
    const business = await this.businesses.findBySlug(slug);
    if (!business.coverKey) throw new NotFoundException('Cover photo not found.');
    const data = await this.storage.get(business.coverKey);
    if (!data) throw new NotFoundException('Cover photo not found.');
    res.set('Content-Type', business.coverMime ?? 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(data);
  }

  /**
   * One QR per business (REQ-008/046). The target is derived every time from
   * the canonical public URL, so a slug change automatically re-points the QR
   * without any re-encoding step (REQ-049).
   */
  @Get(':slug/qr')
  async qr(@Param('slug') slug: string, @Res() res: Response): Promise<void> {
    await this.businesses.findBySlug(slug);
    const target = `${this.config.publicBaseUrl}/b/${slug}`;
    const png = await QRCode.toBuffer(target, { type: 'png', width: 320, margin: 1 });
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=3600');
    res.set('X-Content-Type-Options', 'nosniff');
    res.send(png);
  }
}
