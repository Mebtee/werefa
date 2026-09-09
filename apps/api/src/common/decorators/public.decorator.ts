import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'werefa:isPublic';

/** Marks an endpoint as public (no session required). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
