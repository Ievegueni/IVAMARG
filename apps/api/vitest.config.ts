import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

// Testes de integração usam uma BD própria (<nome>_test), recriada em cada execução.
// Definido em process.env para valer também no globalSetup e nos comandos Prisma que ele lança.
Object.assign(process.env, loadEnv('', process.cwd(), ''));
const dev = new URL(process.env.DATABASE_URL!);
dev.pathname += '_test';
process.env.DATABASE_URL = dev.toString();
process.env.NODE_ENV = 'test';
// Redis db 1: filas de teste não são apanhadas pelo worker de desenvolvimento.
const redis = new URL(process.env.REDIS_URL!);
redis.pathname = '/1';
process.env.REDIS_URL = redis.toString();
process.env.UPLOAD_DIR = 'uploads-test';

export default defineConfig({ test: { globalSetup: './test/global-setup.ts', fileParallelism: false } });
