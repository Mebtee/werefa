import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AppError, ValidationRejectedException } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { firstConstraint } from '../../common/validation/validation-setup';

/**
 * Multipart JSON-field parser (Prompt 50).
 *
 * Multipart endpoints carry the structured JSON payload in a text field named
 * `payload` plus a binary `proof` file field. The global ValidationPipe cannot
 * validate the JSON string, so this helper re-runs the exact same
 * class-validator rules (whitelist + first-constraint field mapping) used by
 * the global pipe, producing the identical envelope.
 */
export async function parseMultipartPayload<T extends object>(
  raw: string | undefined,
  dto: new () => T,
): Promise<T> {
  if (!raw || raw.trim().length === 0) {
    throw missingField('payload', 'The JSON request payload must be provided.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw missingField('payload', 'The payload field is not valid JSON.');
  }
  const instance = plainToInstance(dto, parsed, { exposeDefaultValues: true });
  const errors = await validate(instance as object, { whitelist: true });
  if (errors.length > 0) {
    throw new ValidationRejectedException(firstConstraint(errors));
  }
  return instance as T;
}

function missingField(field: string, detail: string): AppError {
  return new AppError({
    code: ErrorCode.VALIDATION_ERROR,
    title: 'Invalid request',
    status: 400,
    detail,
    fields: { [field]: detail },
  });
}