import { formatKz } from '@ivamarg/shared';
import PDFDocument from 'pdfkit';
import { getSetting } from '../../lib/settings';
import type { getRun } from './service';

type Run = Awaited<ReturnType<typeof getRun>>;

/** Recibos de vencimento: uma página por trabalhador. */
export async function payslipsPdf(run: Run, employeeId?: string): Promise<Buffer> {
  const [company, nif] = await Promise.all([getSetting('company.name', ''), getSetting('company.nif', '')]);
  const slips = run.payslips.filter((p) => !employeeId || p.employeeId === employeeId);
  const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: `Recibos ${run.period}` } });
  const chunks: Buffer[] = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  const left = 50;
  const width = doc.page.width - 100;

  slips.forEach((p, i) => {
    if (i) doc.addPage();
    const e = p.employee;
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#000').text(company, left, 50);
    if (nif) doc.font('Helvetica').fontSize(9).fillColor('#555').text(`NIF: ${nif}`);
    doc.moveDown(1.5).font('Helvetica-Bold').fontSize(16).fillColor('#000').text(`Recibo de vencimento - ${run.period}`);
    doc.moveDown(0.5).font('Helvetica').fontSize(10);
    for (const [k, v] of [['Trabalhador', `${e.number} - ${e.name}`], ['Função', [e.position, e.department].filter(Boolean).join(' / ')], ['NIF', e.nif], ['N.º INSS', e.inssNumber], ['IBAN', [e.bank, e.iban].filter(Boolean).join(' ')]])
      if (v) doc.text(`${k}: ${v}`);

    const rows: [string, number, 'earn' | 'ded' | 'total'][] = [
      ['Vencimento base', p.baseSalary, 'earn'],
      ['Subsídio de alimentação', p.mealAllowance, 'earn'],
      ['Subsídio de transporte', p.transportAllowance, 'earn'],
      ['Outros subsídios', p.otherAllowances, 'earn'],
      [`Horas extra (${p.overtimeHours} h)`, p.overtimePay, 'earn'],
      ['Produção à peça', p.piecePay, 'earn'],
      ['Prémios', p.bonus, 'earn'],
      [`Faltas injustificadas (${p.absences} dia(s))`, -p.absenceDeduction, 'ded'],
      ['Total ilíquido', p.gross, 'total'],
      ['Segurança social (INSS)', -p.inssEmployee, 'ded'],
      ['IRT', -p.irt, 'ded'],
      ['Outros descontos', -p.otherDeductions, 'ded'],
      ['Líquido a receber', p.net, 'total'],
    ];
    let y = doc.y + 20;
    for (const [label, value, kind] of rows) {
      if (!value && kind !== 'total') continue;
      if (kind === 'total') doc.moveTo(left, y - 3).lineTo(left + width, y - 3).strokeColor('#cbd5e1').stroke();
      doc.font(kind === 'total' ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).fillColor(kind === 'ded' ? '#b91c1c' : '#000');
      doc.text(label, left, y, { width: width - 150 });
      doc.text(formatKz(value), left + width - 150, y, { width: 150, align: 'right' });
      y += 20;
    }
    doc.font('Helvetica').fontSize(8).fillColor('#555').text(`Encargo da empresa (INSS ${formatKz(p.inssEmployer)}) não descontado ao trabalhador.`, left, y + 10, { width });
    if (p.notes) doc.text(`Notas: ${p.notes}`, { width });
    doc.text('Recebi o valor líquido acima indicado.', left, y + 80);
    doc.moveTo(left, y + 130).lineTo(left + 220, y + 130).strokeColor('#000').stroke();
    doc.text('Assinatura do trabalhador', left, y + 135);
  });
  if (!slips.length) doc.font('Helvetica').fontSize(12).text('Sem recibos nesta folha.');
  doc.end();
  return done;
}
