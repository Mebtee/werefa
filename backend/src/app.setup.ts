import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import express from 'express';
import { AppConfig } from './config/app-config';
import { LOGGER } from './common/logging/logging.module';
import { PinoLoggerService } from './common/logging/pino-logger.service';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter';
import { buildGlobalValidationPipe } from './common/validation/validation-setup';
import { createHttpLogger } from './common/logging/pino.factory';
import { requestContext } from './common/context/request-context.middleware';
import { setupOpenApi } from './api/openapi';

/**
 * Central application configuration — security defaults, logging, error
 * handling, validation, API version prefix. Shared between bootstrap and
 * test setup so that e2e tests run the identical middleware stack (Prompt 39 §14).
 */
export async function configureApp(app: NestExpressApplication, config: AppConfig): Promise<void> {
  // Replace Nest console logger with structured pino (doc 24 §1)
  app.useLogger(app.get(PinoLoggerService));

  // Request-scoped context carrier (requestId correlation via AsyncLocalStorage)
  // Runs FIRST so subsequent middleware and handlers inherit the store.
  app.use(requestContext);

  // HTTP access log (pino-http) — sets req.id and logs on response 'finish'
  const httpLogger = createHttpLogger(config, app.get(LOGGER));
  app.use(httpLogger);

  // Security defaults (architecture doc 14 §1)
  app.use(
    helmet({
      contentSecurityPolicy: false,           // not needed for API-only surface
      crossOriginEmbedderPolicy: false,
    }),
  );

  // CORS — only enabled when explicit origins are configured; credentials true
  // for future httpOnly session cookies.
  if (config.corsOrigins.length) {
    app.enableCors({
      origin: config.corsOrigins,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'X-Request-Id', 'X-Requested-With'],
      exposedHeaders: ['X-Request-Id'],
    });
  }

  // Body size limit (Express/PayloadTooLargeError → envelope 413)
  app.useBodyParser('json', { limit: config.bodyLimit });
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    const errType = (err as { type?: string } | null | undefined)?.type;
    if (errType === 'entity.too.large') {
      res.status(413).json({
        error: { code: 'FILE_TOO_LARGE', title: 'Request body too large', detail: 'Request body exceeds the allowed size.', fields: null },
      });
      return;
    }
    next(err as Error);
  });

  // Trust proxy headers only behind a reverse proxy
  expressApp.set('trust proxy', config.trustProxy);

  // API version prefix
  app.setGlobalPrefix('api/v1');

  // Global pipes (spec §33 / doc 23 validation)
  app.useGlobalPipes(buildGlobalValidationPipe() as unknown as ValidationPipe);

  // Global exception filter — must run AFTER pipes so validation errors
  // throw before the catch.
  app.useGlobalFilters(new AllExceptionsFilter(app.get(LOGGER)));

  // Graceful shutdown on SIGTERM/SIGINT
  app.enableShutdownHooks();

  // OpenAPI docs + Swagger UI (non-production, non-test only; Prompt 42 §21)
  if (config.nodeEnv !== 'production' && config.nodeEnv !== 'test') {
    setupOpenApi(app);
  }
}