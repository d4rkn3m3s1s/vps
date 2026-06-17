import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  APP_NAME: z.string().default('VPS Emulator Platform'),
  API_BASE_URL: z.string().url().default('http://localhost:4000'),
  WEB_BASE_URL: z.string().url().default('http://localhost:3000'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),
  ADMIN_EMAIL: z.string().email(),
  ADMIN_PASSWORD: z.string().min(8),
  DEFAULT_API_KEY: z.string().min(16),
  ADB_BIN: z.string().default('adb'),
  DOCKER_BIN: z.string().default('docker'),
  EMULATOR_IMAGE: z.string().default('budtmo/docker-android-x86-11.0'),
  UPLOAD_DIR: z.string().default('./storage'),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
  LOG_LEVEL: z.string().default('info'),
  REDIS_QUEUE_PREFIX: z.string().default('vps')
  ,
  TWITTER_CLIENT_ID: z.string().optional(),
  TWITTER_CLIENT_SECRET: z.string().optional(),
  META_CLIENT_ID: z.string().optional(),
  META_CLIENT_SECRET: z.string().optional(),
  INSTAGRAM_CLIENT_ID: z.string().optional(),
  INSTAGRAM_CLIENT_SECRET: z.string().optional(),
  SOCIAL_CRYPTO_KEY: z.string().min(16).optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_PRO: z.string().optional(),
  STRIPE_PRICE_SCALE: z.string().optional(),
  // Email (SMTP). When SMTP_HOST is unset the mailer logs to console (dev mode).
  MAIL_FROM: z.string().default('VPS Fleet <no-reply@vpsfleet.local>'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_SECURE: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true')
});

const parsed = envSchema.parse(process.env);

export const env = {
  nodeEnv: parsed.NODE_ENV,
  port: parsed.PORT,
  appName: parsed.APP_NAME,
  apiBaseUrl: parsed.API_BASE_URL,
  webBaseUrl: parsed.WEB_BASE_URL,
  databaseUrl: parsed.DATABASE_URL,
  redisUrl: parsed.REDIS_URL,
  jwtAccessSecret: parsed.JWT_ACCESS_SECRET,
  jwtRefreshSecret: parsed.JWT_REFRESH_SECRET,
  jwtAccessExpiresIn: parsed.JWT_ACCESS_EXPIRES_IN,
  jwtRefreshExpiresIn: parsed.JWT_REFRESH_EXPIRES_IN,
  adminEmail: parsed.ADMIN_EMAIL,
  adminPassword: parsed.ADMIN_PASSWORD,
  defaultApiKey: parsed.DEFAULT_API_KEY,
  adbBin: parsed.ADB_BIN,
  dockerBin: parsed.DOCKER_BIN,
  emulatorImage: parsed.EMULATOR_IMAGE,
  uploadDir: parsed.UPLOAD_DIR,
  rateLimitWindowMs: parsed.RATE_LIMIT_WINDOW_MS,
  rateLimitMax: parsed.RATE_LIMIT_MAX,
  logLevel: parsed.LOG_LEVEL,
  redisQueuePrefix: parsed.REDIS_QUEUE_PREFIX
  ,
  twitterClientId: parsed.TWITTER_CLIENT_ID,
  twitterClientSecret: parsed.TWITTER_CLIENT_SECRET,
  metaClientId: parsed.META_CLIENT_ID,
  metaClientSecret: parsed.META_CLIENT_SECRET,
  instagramClientId: parsed.INSTAGRAM_CLIENT_ID,
  instagramClientSecret: parsed.INSTAGRAM_CLIENT_SECRET,
  socialCryptoKey: parsed.SOCIAL_CRYPTO_KEY,
  stripeSecretKey: parsed.STRIPE_SECRET_KEY,
  stripeWebhookSecret: parsed.STRIPE_WEBHOOK_SECRET,
  stripePricePro: parsed.STRIPE_PRICE_PRO,
  stripePriceScale: parsed.STRIPE_PRICE_SCALE,
  mailFrom: parsed.MAIL_FROM,
  smtpHost: parsed.SMTP_HOST,
  smtpPort: parsed.SMTP_PORT,
  smtpUser: parsed.SMTP_USER,
  smtpPass: parsed.SMTP_PASS,
  smtpSecure: parsed.SMTP_SECURE
} as const;
