import { z } from 'zod';
import { ValidationError } from '@openshelf/errors';

export {
  registerSchema,
  verifyOtpSchema,
  loginSchema,
  type RegisterInput,
  type VerifyOtpInput,
  type LoginInput,
} from '@openshelf/types';

export interface PendingRegistration {
  name: string;
  email: string;
  hashedPassword: string;
}

export function parseOrThrow<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ValidationError('Invalid request data', result.error.issues);
  }
  return result.data;
}
