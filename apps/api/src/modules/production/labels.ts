import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { env } from '../../lib/env';

type LotLabel = { number: string; qrToken: string; size: string | null; quantity: number; productModel: { reference: string; name: string } };

/** URL codificado no QR: abre o ecrã de chão de fábrica directamente no lote (também lido pelo leitor da app). */
export const lotUrl = (token: string) => `${env.APP_URL}/chao?lote=${token}`;

/** Etiquetas A4, 2 × 5 por página, com QR, nº do lote, OP, cliente, modelo, tamanho e quantidade. */
export async function labelsPdf(po: { number: string; order: { number: string; client: { name: string } } }, lots: LotLabel[]): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 20, info: { Title: `Etiquetas ${po.number}` } });
  const chunks: Buffer[] = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise<Buffer>((r) => doc.on('end', () => r(Buffer.concat(chunks))));

  const cols = 2, rows = 5;
  const w = (doc.page.width - 40) / cols;
  const h = (doc.page.height - 40) / rows;
  for (const [i, lot] of lots.entries()) {
    const slot = i % (cols * rows);
    if (i && !slot) doc.addPage();
    const x = 20 + (slot % cols) * w;
    const y = 20 + Math.floor(slot / cols) * h;
    doc.rect(x + 4, y + 4, w - 8, h - 8).dash(3, { space: 3 }).strokeColor('#bbb').stroke().undash();
    const qr = await QRCode.toBuffer(lotUrl(lot.qrToken), { margin: 1, width: 300, errorCorrectionLevel: 'M' });
    const size = h - 30;
    doc.image(qr, x + 12, y + 15, { width: size, height: size });
    const tx = x + 20 + size;
    const tw = w - size - 36;
    doc.fillColor('#000').font('Helvetica-Bold').fontSize(10.5).text(lot.number, tx, y + 18, { width: tw, lineBreak: false });
    doc.font('Helvetica').fontSize(9).fillColor('#333')
      .text(`${po.number} · ${po.order.number}`, { width: tw })
      .text(po.order.client.name, { width: tw })
      .moveDown(0.4)
      .font('Helvetica-Bold').fontSize(10).fillColor('#000').text(`${lot.productModel.reference} - ${lot.productModel.name}`, { width: tw })
      .moveDown(0.3)
      .fontSize(16).text(`${lot.size ? `Tam. ${lot.size} · ` : ''}${lot.quantity} pç`, { width: tw });
  }
  doc.end();
  return done;
}
