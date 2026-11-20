import { execSync } from 'node:child_process';

// Não destrutivo: aplica migrações e seed (idempotente) na BD *_test. Os testes usam dados únicos por execução.
export default function setup() {
  if (!process.env.DATABASE_URL?.includes('_test')) throw new Error('Testes só correm contra uma BD *_test');
  execSync('npx prisma migrate deploy', { stdio: 'ignore' });
  execSync('npx tsx prisma/seed.ts', { stdio: 'ignore' });
}
