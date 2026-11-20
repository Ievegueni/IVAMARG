import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import QRCode from 'qrcode';
import { describe, expect, it } from 'vitest';
import { lotUrl } from './labels';

describe('QR dos lotes', () => {
  it('o QR da etiqueta descodifica para o link do chão de fábrica com o token do lote', async () => {
    const url = lotUrl('Ab3_x-9Zq');
    const png = PNG.sync.read(await QRCode.toBuffer(url, { margin: 1, width: 300, errorCorrectionLevel: 'M' }));
    const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
    expect(decoded?.data).toBe(url);
    expect(decoded?.data.match(/lote=([\w-]+)/)?.[1]).toBe('Ab3_x-9Zq'); // o mesmo padrão que o servidor usa
  });
});
