// Teste de restauro: faz um backup, restaura-o numa base temporária, compara contagens e apaga a base temporária.
//   npm -w apps/api run backup:verify            (usa o backup acabado de criar)
//   npm -w apps/api run backup:verify -- <ficheiro.dump>
import { PrismaClient } from '@prisma/client';
import { pgUrl, run, runBackup } from '../src/jobs/backup';
import { env } from '../src/lib/env';

const TABLES = ['User', 'Client', 'Proposal', 'Order', 'ProductionOrder', 'Lot', 'StageLog', 'StockItem', 'StockMovement', 'Invoice', 'Receivable', 'Payment', 'Document', 'AuditLog'];
const file = process.argv[2] ?? (await runBackup()).file;
const source = new URL(pgUrl());
const tmpName = `${source.pathname.slice(1)}_restore_check_${Date.now()}`;
const admin = new URL(source.toString());
admin.pathname = '/postgres';
const target = new URL(source.toString());
target.pathname = `/${tmpName}`;

const count = async (url: string) => {
  const db = new PrismaClient({ datasourceUrl: url });
  const out: Record<string, number> = {};
  for (const t of TABLES) out[t] = Number((await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "${t}"`))[0].n);
  await db.$disconnect();
  return out;
};

console.log(`Ficheiro: ${file}`);
await run('psql', [admin.toString(), '-c', `CREATE DATABASE "${tmpName}"`]);
try {
  await run('pg_restore', ['--no-owner', `--dbname=${target.toString()}`, file]);
  const [a, b] = await Promise.all([count(env.DATABASE_URL), count(target.toString())]);
  const diff = TABLES.filter((t) => a[t] !== b[t]);
  console.table(TABLES.map((t) => ({ tabela: t, origem: a[t], restaurado: b[t] })));
  // Diferenças só são possíveis se houve escrita entre o backup e a contagem.
  console.log(diff.length ? `⚠️ Diferenças em: ${diff.join(', ')} (escritas depois do backup?)` : '✔ Restauro verificado: contagens iguais.');
  process.exitCode = diff.length ? 1 : 0;
} finally {
  await run('psql', [admin.toString(), '-c', `DROP DATABASE IF EXISTS "${tmpName}"`]);
}
