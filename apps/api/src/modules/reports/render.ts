import { formatDate, formatKz } from '@ivamarg/shared';
import PDFDocument from 'pdfkit';
import writeXlsxFile from 'write-excel-file/node';
import type { ColType, ReportData } from './data';

const fmt = (v: string | number | null | undefined, t: ColType) =>
  v === null || v === undefined || v === '' ? '-' : t === 'kz' ? formatKz(Number(v)) : t === 'pct' ? `${v}%` : t === 'date' ? formatDate(String(v)) : t === 'num' ? Number(v).toLocaleString('pt-PT') : String(v);

export async function toPdf(r: ReportData, company: string): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36, bufferPages: true, info: { Title: r.title } });
  const chunks: Buffer[] = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise<Buffer>((res) => doc.on('end', () => res(Buffer.concat(chunks))));
  const width = doc.page.width - 72;
  doc.font('Helvetica-Bold').fontSize(16).text(r.title).font('Helvetica').fontSize(9).fillColor('#555').text(`${company} · ${r.subtitle}`).fillColor('#000');
  for (const s of r.sections) {
    doc.moveDown(1).font('Helvetica-Bold').fontSize(11).text(s.title, 36);
    const n = s.columns.length;
    const w = width / n;
    const row = (cells: string[], bold = false) => {
      if (doc.y > doc.page.height - 60) doc.addPage();
      const y = doc.y;
      let h = 0;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
      cells.forEach((c, i) => {
        const right = ['kz', 'num', 'pct'].includes(s.columns[i].type);
        doc.text(c, 36 + i * w + 2, y, { width: w - 4, align: right ? 'right' : 'left' });
        h = Math.max(h, doc.y - y);
      });
      doc.y = y + h + 3;
      doc.moveTo(36, doc.y - 1).lineTo(36 + width, doc.y - 1).strokeColor('#e2e8f0').stroke();
    };
    doc.moveDown(0.3);
    row(s.columns.map((c) => c.label), true);
    if (!s.rows.length) doc.font('Helvetica').fontSize(8).fillColor('#777').text('Sem dados.', 38).fillColor('#000');
    for (const r0 of s.rows) row(s.columns.map((c) => fmt(r0[c.key], c.type)));
    if (s.totals) row(s.columns.map((c, i) => (i === 0 ? 'Total' : c.key in s.totals! ? fmt(s.totals![c.key], c.type) : '')), true);
  }
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0;
    doc.fontSize(7).fillColor('#888').text(`${r.title} · página ${i + 1}/${range.count}`, 36, doc.page.height - 24, { width, align: 'right', lineBreak: false });
  }
  doc.end();
  return done;
}

/** Excel: uma folha por secção; valores numéricos ficam números (somáveis no Excel). */
export async function toXlsx(r: ReportData): Promise<Buffer> {
  const sheets = r.sections.map((s, idx) => ({
    sheet: s.title.slice(0, 28).replace(/[\\/?*[\]:]/g, '') || `Folha ${idx + 1}`,
    columns: s.columns.map((c) => ({ width: c.type === 'text' ? 28 : 16 })),
    data: [
      s.columns.map((c) => ({ value: c.label, fontWeight: 'bold' as const })),
      ...s.rows.map((row) =>
        s.columns.map((c) => {
          const v = row[c.key];
          if (v === null || v === undefined) return null;
          if (c.type === 'date') return { value: new Date(String(v)), format: 'dd/mm/yyyy' };
          if (c.type === 'kz') return { value: Number(v), format: '#,##0 "Kz"' };
          if (c.type === 'num' || c.type === 'pct') return { value: Number(v) };
          return { value: String(v) };
        }),
      ),
      ...(s.totals ? [s.columns.map((c, i) => (i === 0 ? { value: 'Total', fontWeight: 'bold' as const } : c.key in s.totals! ? { value: s.totals![c.key], format: c.type === 'kz' ? '#,##0 "Kz"' : undefined, fontWeight: 'bold' as const } : null))] : []),
    ],
  }));
  return writeXlsxFile(sheets as never).toBuffer();
}
