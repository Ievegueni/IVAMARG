import { z } from 'zod';

const optional = z.string().optional().transform((v) => v || undefined);

export const env = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().default(3000),
    DATABASE_URL: z.string(),
    REDIS_URL: z.string(),
    JWT_SECRET: z.string().min(32, 'JWT_SECRET deve ter pelo menos 32 caracteres'),
    APP_URL: z.string().url(),
    SMTP_HOST: optional,
    SMTP_PORT: z.coerce.number().default(587),
    SMTP_USER: optional,
    SMTP_PASS: optional,
    SMTP_FROM: z.string().default('Ivamarg <noreply@ivamarg.ao>'),
    CLOUDINARY_URL: optional,
    UPLOAD_DIR: z.string().default('uploads'),
    BACKUP_DIR: z.string().default('backups'),
    BACKUP_RETENTION_DAYS: z.coerce.number().default(30),
    VENDUS_API_URL: z.string().default('https://www.vendus.pt/ws/v1.1'),
    VENDUS_API_KEY: optional,
    META_APP_SECRET: optional,
    META_GRAPH_VERSION: z.string().default('v21.0'),
    WA_PHONE_NUMBER_ID: optional,
    WA_ACCESS_TOKEN: optional,
    FB_PAGE_ACCESS_TOKEN: optional,
    FUTURIX_SMS_API_URL: optional,
    FUTURIX_SMS_API_KEY: optional,
    FUTURIX_SMS_SENDER: optional,
    META_VERIFY_TOKEN: optional,
  })
  .parse(process.env);
