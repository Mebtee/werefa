import { ArgumentMetadata, ValidationPipe } from '@nestjs/common';
import { IsString, MinLength } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { buildGlobalValidationPipe } from './validation-setup';
import { ValidationRejectedException } from '../errors/app-error';

class ContactDto {
  @IsString()
  name!: string;

  @IsString()
  @MinLength(2)
  phone!: string;
}

const metadata: ArgumentMetadata = { type: 'body', metatype: ContactDto, data: undefined };

describe('buildGlobalValidationPipe', () => {
  it('whitelists unknown properties', async () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { exposeDefaultValues: true },
    });
    const out = await pipe.transform({ name: 'Amsalu', phone: '0911', admin: true }, metadata);
    expect(out).not.toHaveProperty('admin');
  });

  it('throws a ValidationRejectedException with per-field messages', async () => {
    const pipe = buildGlobalValidationPipe() as unknown as ValidationPipe;
    await expect(pipe.transform({ name: 123, phone: 'x' }, metadata)).rejects.toBeInstanceOf(ValidationRejectedException);
    try {
      await pipe.transform({ name: 123, phone: 'x' }, metadata);
    } catch (err) {
      const fields = (err as ValidationRejectedException).fields;
      expect(Object.keys(fields ?? {})).toEqual(expect.arrayContaining(['name', 'phone']));
    }
  });

  it('passes valid payloads through', async () => {
    const pipe = buildGlobalValidationPipe() as unknown as ValidationPipe;
    const out = await pipe.transform({ name: 'Amsalu', phone: '0911223344' }, metadata);
    expect(out.name).toBe('Amsalu');
    expect(out.phone).toBe('0911223344');
  });
});