import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/**
 * OpenAPI/Swagger setup (Prompt 42 §21). Served at `/api/v1/swagger` in
 * non-production environments only. The document describes the real, tested
 * HTTP contract — no invented routes.
 */
export function setupOpenApi(app: INestApplication): void {
  const builder = new DocumentBuilder()
    .setTitle('Werefa API')
    .setDescription('Versioned HTTP API for the Werefa booking platform. /api/v1 prefix (Prompt 39/42).')
    .setVersion('v1')
    .addTag('public', 'Public business page, services and availability (no auth)')
    .addTag('customer', 'Anonymous customer booking + status (no auth, phone-based)')
    .addTag('owner · business', 'Owner business management (owner only)')
    .addTag('owner · catalog', 'Owner service catalog (owner only)')
    .addTag('owner · schedule', 'Owner schedule versions and exceptions (owner only)')
    .addTag('owner · bookings', 'Owner booking lifecycle (owner only)');

  const document = SwaggerModule.createDocument(app, builder.build());
  SwaggerModule.setup('api/v1/swagger', app, document, {
    jsonDocumentUrl: 'api/v1/openapi-json',
    swaggerOptions: { persistAuthorization: false, tryItOutEnabled: false },
  });
}