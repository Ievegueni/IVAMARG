import { formatDate, formatDateTime, PO_STATUS, PRIORITY } from '@ivamarg/shared';
import PDFDocument from 'pdfkit';
import { getSetting } from '../../lib/settings';
import type { getPO } from './service';

type PO = Awaited<ReturnType<typeof getPO>>;
const qty = (n: number) => n.toLocaleString('pt-PT', { maximumFractionDigits: 3 });

/** Ordem de produção para imprimir e acompanhar na fábrica (sem custos): artigos, materiais, lotes por etapa e assinaturas. */
export async function productionOrderPdf(po: PO): Promise<Buffer> {
  const company = await getSetting('company.name', '');
  const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `Ordem de produção ${po.number}` } });
  const chunks: Buffer[] = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  const left = 40;
  const width = doc.page.width - 80;
  const bottom = () => doc.page.height - 60;

  /** Tabela simples: cabeçalho a cinzento, linhas com quebra de página (repete o cabeçalho). */
  const table = (cols: { label: string; w: number; align?: 'left' | 'right' | 'center' }[], rows: string[][]) => {
    const head = () => {
      let x = left;
      const y = doc.y;
      doc.font('Helvetica-Bold').fontSize(7.5);
      const h = Math.max(...cols.map((c) => doc.heightOfString(c.label, { width: c.w - 4 }))) + 6;
      doc.rect(left, y - 2, width, h).fill('#f1f5f9').fillColor('#334155');
      for (const c of cols) { doc.text(c.label, x + 2, y + 2, { width: c.w - 4, align: c.align }); x += c.w; }
      doc.y = y + h;
    };
    head();
    doc.font('Helvetica').fontSize(9).fillColor('#000');
    for (const r of rows) {
      const h = Math.max(16, ...r.map((v, i) => doc.heightOfString(v, { width: cols[i].w - 6 }) + 6));
      if (doc.y + h > bottom()) { doc.addPage(); head(); doc.font('Helvetica').fontSize(9).fillColor('#000'); }
      const y = doc.y;
      let x = left;
      r.forEach((v, i) => { doc.text(v, x + 3, y + 3, { width: cols[i].w - 6, align: cols[i].align }); x += cols[i].w; });
      doc.moveTo(left, y + h).lineTo(left + width, y + h).strokeColor('#e2e8f0').stroke();
      doc.y = y + h;
    }
    doc.x = left;
    doc.moveDown(1);
  };
  const section = (title: string) => {
    if (doc.y > bottom() - 60) doc.addPage();
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#000').text(title, left, doc.y).moveDown(0.3);
  };

  // Cabeçalho
  doc.font('Helvetica').fontSize(9).fillColor('#555').text(company, left, 40);
  doc.text(`Impresso em ${formatDateTime(new Date())}`, left, 40, { width, align: 'right' });
  doc.moveDown(0.8).font('Helvetica-Bold').fontSize(18).fillColor('#000').text(`Ordem de produção ${po.number}`, left);
  doc.moveDown(0.4);
  const info: [string, string][] = [
    ['Encomenda', po.order.number], ['Cliente', po.order.client.name],
    ['Prazo', po.order.deadline ? formatDate(po.order.deadline) : '-'], ['Prioridade', PRIORITY[po.order.priority]],
    ['Estado', PO_STATUS[po.status]], ['Peças', `${po.quantity}${po.lots.length ? ` em ${po.lots.length} lotes` : ''}`],
  ];
  const colW = width / 3;
  const y0 = doc.y;
  info.forEach(([k, v], i) => {
    const x = left + (i % 3) * colW, y = y0 + Math.floor(i / 3) * 28;
    doc.font('Helvetica').fontSize(8).fillColor('#64748b').text(k, x, y, { width: colW - 8 });
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#000').text(v, x, y + 10, { width: colW - 8, lineBreak: false, ellipsis: true });
  });
  doc.y = y0 + 62;
  doc.x = left;
  const notes = [['Personalização (nome)', po.order.personalizationName], ['Personalização (notas)', po.order.personalizationNotes], ['Notas da encomenda', po.order.notes]].filter(([, v]) => v);
  for (const [k, v] of notes) doc.font('Helvetica-Bold').fontSize(9).fillColor('#000').text(`${k}: `, { continued: true }).font('Helvetica').text(v!);
  if (notes.length) doc.moveDown(0.8);

  section('Artigos');
  table(
    [{ label: 'Modelo', w: 150 }, { label: 'Cor', w: 70 }, { label: 'Detalhe', w: 125 }, { label: 'Tamanhos', w: 125 }, { label: 'Qtd', w: width - 470, align: 'right' }],
    po.items.map((i) => [
      `${i.productModel.reference} - ${i.productModel.name}`,
      i.orderLine.color ?? '-',
      i.orderLine.details ?? '-',
      Object.entries(i.sizeGrid as Record<string, number>).map(([s, q]) => `${s}: ${q}`).join('  ') || '-',
      String(i.quantity),
    ]),
  );

  const materials = po.status === 'DRAFT'
    ? po.shortages.map((s) => [`${s.code} - ${s.name}`, `${qty(s.required)} ${s.unit}`, `${qty(s.available)} ${s.unit}`, s.shortage ? `Falta ${qty(s.shortage)}` : 'OK'])
    : po.consumption.map((c) => [`${c.code} - ${c.name}`, `${qty(c.required)} ${c.unit}`, `${qty(c.issued)} ${c.unit}`, '']);
  if (materials.length) {
    section('Materiais (ficha técnica)');
    table([{ label: 'Material', w: 235 }, { label: 'Necessário', w: 100, align: 'right' }, { label: po.status === 'DRAFT' ? 'Disponível' : 'Entregue', w: 100, align: 'right' }, { label: po.status === 'DRAFT' ? 'Situação' : 'Obs.', w: width - 435 }], materials);
  }

  if (po.lots.length) {
    // Uma coluna por etapa: quantidade já concluída, ou espaço para registar à mão.
    section('Lotes e etapas');
    const fixed = 200;
    const sw = (width - fixed) / Math.max(po.stages.length, 1);
    table(
      [{ label: 'Lote', w: 88 }, { label: 'Modelo', w: 60 }, { label: 'Tam.', w: 26, align: 'center' }, { label: 'Qtd', w: 26, align: 'right' }, ...po.stages.map((s) => ({ label: s.name.replace('/', '/ '), w: sw, align: 'center' as const }))],
      po.lots.map((l) => [l.number, l.productModel.reference, l.size ?? '-', String(l.quantity), ...l.flow.map((f) => (f.done ? String(f.done) : ''))]),
    );
  }

  if (doc.y > bottom() - 70) doc.addPage();
  const sy = Math.max(doc.y + 30, bottom() - 50);
  for (const [i, label] of ['Responsável de produção', 'Controlo de qualidade', 'Data'].entries()) {
    const x = left + i * (width / 3);
    doc.moveTo(x, sy).lineTo(x + width / 3 - 20, sy).strokeColor('#000').stroke();
    doc.font('Helvetica').fontSize(8).fillColor('#555').text(label, x, sy + 4);
  }
  doc.end();
  return done;
}
