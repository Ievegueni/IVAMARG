import { formatDate, formatKz } from '@ivamarg/shared';
import PDFDocument from 'pdfkit';
import { prisma } from '../../lib/prisma';
import type { getProposal } from './service';

type P = Awaited<ReturnType<typeof getProposal>>;

const setting = async (key: string) => ((await prisma.setting.findUnique({ where: { key } }))?.value as string) || '';

/** PDF de uma versão da proposta, com logótipo e dados da empresa configurados no backoffice. */
export async function proposalPdf(p: P, versionNo: number): Promise<Buffer> {
  const v = p.versions.find((x) => x.version === versionNo);
  if (!v) throw new Error('Versão inexistente');
  const [company, nif, address, contacts, logo] = await Promise.all(
    ['company.name', 'company.nif', 'company.address', 'company.contacts', 'company.logo'].map(setting),
  );

  const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true, info: { Title: `${p.number} v${v.version}` } });
  const chunks: Buffer[] = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const left = 50;
  const width = doc.page.width - 100;

  // Cabeçalho
  if (logo.startsWith('data:image/')) {
    try {
      doc.image(Buffer.from(logo.split(',')[1], 'base64'), left, 45, { fit: [140, 60] });
    } catch {
      /* logótipo inválido: ignora */
    }
  }
  doc.font('Helvetica-Bold').fontSize(12).text(company, left, 45, { width, align: 'right' });
  doc.font('Helvetica').fontSize(9).fillColor('#555');
  if (nif) doc.text(`NIF: ${nif}`, { width, align: 'right' });
  if (address) doc.text(address, { width, align: 'right' });

  doc.moveDown(3).fillColor('#000').font('Helvetica-Bold').fontSize(18).text(p.mode === 'PHASES' ? 'Proposta / Orçamento de obra' : 'Proposta comercial', left);
  doc.font('Helvetica').fontSize(10).fillColor('#555')
    .text(`${p.number} · versão ${v.version} · ${formatDate(v.sentAt ?? v.createdAt)}${v.validUntil ? ` · válida até ${formatDate(v.validUntil)}` : ''}`);
  doc.moveDown().fillColor('#000').font('Helvetica-Bold').fontSize(11).text(p.title);

  // Cliente
  doc.moveDown().font('Helvetica-Bold').fontSize(10).text('Cliente');
  doc.font('Helvetica').text(p.client.name);
  if (p.client.nif) doc.text(`NIF: ${p.client.nif}`);
  if (p.client.address) doc.text(p.client.address);

  // Tabela
  const cols = p.mode === 'PHASES'
    ? [{ h: 'Fase', w: 0.55 }, { h: 'Qtd', w: 0.1, r: true }, { h: 'Valor', w: 0.15, r: true }, { h: 'Total', w: 0.2, r: true }]
    : [{ h: 'Descrição', w: 0.45 }, { h: 'Qtd', w: 0.1, r: true }, { h: 'Preço unit.', w: 0.16, r: true }, { h: 'Desc.', w: 0.09, r: true }, { h: 'Total', w: 0.2, r: true }];
  const row = (cells: string[], bold = false) => {
    const y = doc.y;
    let x = left;
    let h = 0;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
    cells.forEach((c, i) => {
      const w = cols[i].w * width;
      doc.text(c, x + 2, y, { width: w - 4, align: cols[i].r ? 'right' : 'left' });
      h = Math.max(h, doc.y - y);
      x += w;
    });
    doc.y = y + h + 4;
    doc.moveTo(left, doc.y - 2).lineTo(left + width, doc.y - 2).strokeColor('#ddd').stroke();
    if (doc.y > doc.page.height - 120) doc.addPage();
  };
  doc.moveDown(1.5);
  row(cols.map((c) => c.h), true);
  for (const it of v.items) {
    const qty = Number(it.quantity).toLocaleString('pt-PT', { maximumFractionDigits: 3 });
    const disc = Number(it.discountPct);
    row(p.mode === 'PHASES'
      ? [it.description, qty, formatKz(it.unitPrice), formatKz(it.total)]
      : [it.description, qty, formatKz(it.unitPrice), disc ? `${disc}%` : '-', formatKz(it.total)]);
  }
  doc.moveDown(0.5).font('Helvetica-Bold').fontSize(12).text(`Total: ${formatKz(v.total)}`, left, doc.y, { width, align: 'right' });
  doc.font('Helvetica').fontSize(8).fillColor('#555').text('Valores em Kwanzas (AOA). Impostos aplicáveis conforme a legislação em vigor, discriminados na factura.', { width, align: 'right' });

  if (v.notes) {
    doc.moveDown(1.5).fillColor('#000').font('Helvetica-Bold').fontSize(10).text('Condições / observações', left);
    doc.font('Helvetica').fontSize(9).text(v.notes, { width });
  }

  // Rodapé
  const footer = [company, contacts].filter(Boolean).join(' · ');
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0; // senão escrever no rodapé abre uma página nova
    doc.fontSize(8).fillColor('#888').text(footer, left, doc.page.height - 40, { width, align: 'center', lineBreak: false });
  }
  doc.end();
  return done;
}
