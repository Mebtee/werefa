import { ValidationError, ValidationPipe } from '@nestjs/common';
import { ValidationRejectedException } from '../errors/app-error';

function firstConstraint(errors: ValidationError[]): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const err of errors) {
    if (err.constraints) {
      const values = Object.values(err.constraints);
      fields[err.property] = values[0] ?? 'Invalid value';
      continue;
    }
    if (err.children?.length) {
      const nested = firstConstraint(err.children);
      for (const [k, v] of Object.entries(nested)) {
        fields[`${err.property}.${k}`] = v;
      }
    }
  }
  return fields;
}

export function buildGlobalValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    transform: true,
    transformOptions: { exposeDefaultValues: true },
    exceptionFactory: (errors: ValidationError[]) => new ValidationRejectedException(firstConstraint(errors)),
  });
}