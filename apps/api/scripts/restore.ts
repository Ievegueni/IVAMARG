// Restauro de um backup para uma base de dados indicada (NUNCA a de produção em uso):
//   npm -w apps/api run db:restore -- <ficheiro.dump> <postgresql://…/base_nova>
// Procedimento recomendado: restaurar para uma base nova, validar, e só depois apontar DATABASE_URL para ela.
import { run } from '../src/jobs/backup';
import { env } from '../src/lib/env';

const [file, target] = process.argv.slice(2);
if (!file || !target) {
  console.error('Uso: db:restore -- <ficheiro.dump> <url-da-base-destino>');
  process.exit(1);
}
if (target.split('?')[0] === env.DATABASE_URL.split('?')[0]) {
  console.error('Recusado: o destino é a base de dados em uso (DATABASE_URL). Restaure para uma base nova.');
  process.exit(1);
}
await run('pg_restore', ['--no-owner', '--clean', '--if-exists', `--dbname=${target}`, file]);
console.log(`Restaurado ${file} → ${target.replace(/:[^:@/]+@/, ':***@')}`);
