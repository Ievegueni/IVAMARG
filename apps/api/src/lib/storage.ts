import { v2 as cloudinary } from 'cloudinary';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { env } from './env';

// Ficheiros: Cloudinary (raw, entrega autenticada) quando CLOUDINARY_URL existe; senão disco local
// (desenvolvimento). Em ambos os casos o download é por URL assinado e temporário.

const useCloud = !!env.CLOUDINARY_URL; // o SDK lê CLOUDINARY_URL do ambiente
const root = resolve(env.UPLOAD_DIR);

export async function putFile(buf: Buffer, folder: string, filename: string) {
  const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')).toLowerCase().replace(/[^.\w]/g, '') : '';
  const key = `${folder}/${Date.now()}-${randomBytes(6).toString('hex')}${ext}`;
  if (useCloud) {
    await new Promise((ok, fail) =>
      cloudinary.uploader
        .upload_stream({ resource_type: 'raw', type: 'authenticated', public_id: key }, (e, r) => (e ? fail(e) : ok(r)))
        .end(buf),
    );
  } else {
    const path = join(root, key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, buf);
  }
  return key;
}

const sign = (key: string, exp: number) => createHmac('sha256', env.JWT_SECRET).update(`file:${key}:${exp}`).digest('hex');

/** URL temporário (por defeito 5 min) para ver/descarregar. */
export function signedUrl(key: string, ttlSec = 300, filename?: string) {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  if (useCloud) return cloudinary.utils.private_download_url(key, '', { resource_type: 'raw', type: 'authenticated', expires_at: exp });
  const q = new URLSearchParams({ key, exp: String(exp), sig: sign(key, exp), ...(filename && { name: filename }) });
  return `/api/files?${q}`;
}

/** Valida um URL local assinado e devolve o conteúdo (só modo disco). */
export async function readSigned(key: string, exp: number, sig: string) {
  if (useCloud || exp < Date.now() / 1000) return null;
  const expected = Buffer.from(sign(key, exp));
  const got = Buffer.from(sig);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
  const path = resolve(root, key);
  if (!path.startsWith(root + '/') && !path.startsWith(root + '\\')) return null; // sem path traversal
  return readFile(path);
}
