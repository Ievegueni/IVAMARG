import { spawn } from 'node:child_process';
import { mkdir, readdir, readFile, stat, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { env } from '../lib/env';
import { notify, usersWithPermission } from '../lib/notify';
import { putFile } from '../lib/storage';
import { logged } from './integration-log';
import { queue } from './queues';

/** URL de ligação sem os parâmetros do Prisma (?schema=…), que o pg_dump não aceita. */
export const pgUrl = (url = env.DATABASE_URL) => url.split('?')[0];

export function run(cmd: string, args: string[]) {
  return new Promise<void>((ok, fail) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('error', fail);
    p.on('close', (code) => (code === 0 ? ok() : fail(new Error(`${cmd} saiu com código ${code}: ${err.slice(0, 500)}`))));
  });
}

/** Backup diário: pg_dump (formato custom), cópia para o Cloudinary se configurado, retenção N dias. */
export async function runBackup(now = new Date()) {
  const dir = resolve(env.BACKUP_DIR);
  await mkdir(dir, { recursive: true });
  const stamp = now.toISOString().replace(/[-:]/g, '').slice(0, 13); // AAAAMMDDTHHMM
  const file = join(dir, `ivamarg-${stamp}.dump`);
  return logged('backup', 'pg_dump', { file }, async () => {
    await run('pg_dump', ['--format=custom', '--no-owner', `--file=${file}`, pgUrl()]);
    const size = (await stat(file)).size;
    if (env.CLOUDINARY_URL) await putFile(await readFile(file), 'backups', `ivamarg-${stamp}.dump`); // cópia fora da VPS
    const cutoff = now.getTime() - env.BACKUP_RETENTION_DAYS * 86400000;
    let removed = 0;
    for (const f of await readdir(dir)) {
      if (!/^ivamarg-.*\.dump$/.test(f)) continue;
      if ((await stat(join(dir, f))).mtimeMs < cutoff) {
        await unlink(join(dir, f));
        removed++;
      }
    }
    return { file, size, removed };
  });
}

export async function scheduleBackup() {
  await queue('backup').upsertJobScheduler('daily', { pattern: '0 2 * * *', tz: 'Africa/Luanda' }, { name: 'daily' });
}

export async function processBackup() {
  try {
    return await runBackup();
  } catch (err) {
    await notify(await usersWithPermission('admin.edit'), { title: 'Falha no backup diário', body: String((err as Error).message).slice(0, 200) });
    throw err;
  }
}
