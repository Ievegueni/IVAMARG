import { describe, expect, it } from 'vitest';
import { putFile, readSigned, signedUrl } from './storage';

describe('armazenamento local com URL assinado', () => {
  it('lê com assinatura válida e recusa adulterada, expirada ou fora da pasta', async () => {
    const key = await putFile(Buffer.from('olá'), 'test', 'a.txt');
    const q = new URL(signedUrl(key, 60), 'http://x').searchParams;
    const exp = Number(q.get('exp'));
    expect((await readSigned(key, exp, q.get('sig')!))?.toString()).toBe('olá');
    expect(await readSigned(key, exp, q.get('sig')!.replace(/.$/, '0'))).toBeNull();
    expect(await readSigned(key, exp + 1, q.get('sig')!)).toBeNull();
    expect(await readSigned(key, Math.floor(Date.now() / 1000) - 1, q.get('sig')!)).toBeNull();
    const evil = new URL(signedUrl('../../package.json', 60), 'http://x').searchParams;
    expect(await readSigned('../../package.json', Number(evil.get('exp')), evil.get('sig')!)).toBeNull();
  });
});
