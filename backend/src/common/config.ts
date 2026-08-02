import 'dotenv/config';
import { z } from 'zod';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    DATABASE_URL: z.string().url(),
    JWT_ACCESS_SECRET: z.string().min(8),
    JWT_REFRESH_SECRET: z.string().min(8),
    NOTIFIER: z.enum(['console', 'smtp']).default('console'),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().positive().optional(),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    MAIL_FROM: z.string().optional(),
    /** SLA engine tick interval; 0 disables the scheduler (tests). */
    SLA_TICK_MINUTES: z.coerce.number().int().min(0).default(5),
  })
  .refine((env) => env.NOTIFIER !== 'smtp' || (env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS), {
    message: 'NOTIFIER=smtp requires SMTP_HOST, SMTP_USER and SMTP_PASS',
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Refuse to boot on invalid config — print what is wrong, without leaking values.
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const config = parsed.data;
export type Config = typeof config;
