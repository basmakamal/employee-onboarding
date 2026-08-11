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
    /** Max records one SLA rule processes per tick (backlog safety valve). */
    SLA_BATCH_SIZE: z.coerce.number().int().positive().default(500),
    /**
     * Redis connection (e.g. redis://127.0.0.1:6379). When set, email goes
     * through the BullMQ queue (run `npm run worker`), the SLA engine runs
     * in the worker, and refresh tokens become revocable. When unset the
     * app behaves as before — inline email, in-process SLA timer.
     */
    REDIS_URL: z.string().url().optional(),
    /** Public base URL of the frontend — signed links point here. */
    APP_URL: z.string().url().default('http://localhost:3000'),
    /** Uploaded files live here — outside the webroot, gitignored. */
    UPLOAD_DIR: z.string().default('./storage'),
    /** Signed-link lifetime in hours. */
    LINK_TTL_HOURS: z.coerce.number().int().positive().default(240),
    /** Anthropic API key — AI features are disabled until this is set. */
    ANTHROPIC_API_KEY: z.string().optional(),
    /** Claude model for AI features. */
    AI_MODEL: z.string().default('claude-opus-5'),
    /**
     * Redact personal identifiers (national ID / Iqama) from data sent to
     * the AI API. Defaults ON — sending national identifiers to an external
     * service is a PDPL decision, so it must be opted OUT of explicitly
     * with AI_REDACT_PII=false.
     */
    AI_REDACT_PII: z
      .string()
      .default('true')
      .transform((v) => v !== 'false'),
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
