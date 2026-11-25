import { formatDate, formatKz, normalizePhone, renderTemplate } from '@ivamarg/shared';
import { sendEmail } from '../../jobs/outbound';
import { queue } from '../../jobs/queues';
import { notify, usersWithPermission } from '../../lib/notify';
import { prisma } from '../../lib/prisma';
import { getSetting, isEnabled } from '../../lib/settings';

const DAY = 86400000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const hrUsers = async (...perms: string[]) => [...new Set((await Promise.all(perms.map(usersWithPermission))).flat())];

/** Mensagem ao trabalhador: SMS se activo e houver telefone, senão email. Devolve o canal usado. */
export async function messageEmployee(e: { name: string; phone: string | null; email: string | null }, text: string, subject: string) {
  if (e.phone && (await isEnabled('sms'))) {
    await queue('outbound').add('direct', { channel: 'direct', via: 'SMS', to: normalizePhone(e.phone), text });
    return 'SMS';
  }
  if (e.email) {
    await sendEmail(e.email, subject, `<p>${esc(text)}</p>`);
    return 'EMAIL';
  }
  return null;
}

/** Job diário: felicita os trabalhadores que fazem anos hoje (29/02 → 28/02 em anos comuns) e avisa os RH. */
export async function birthdayGreetings(today: Date) {
  const md = iso(today).slice(5);
  const y = today.getUTCFullYear();
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = md === '02-28' && !leap ? ['02-28', '02-29'] : [md];
  const people = (await prisma.employee.findMany({ where: { deletedAt: null, status: 'ACTIVE', birthDate: { not: null } }, select: { name: true, phone: true, email: true, birthDate: true } }))
    .filter((e) => days.includes(iso(e.birthDate!).slice(5)));
  if (!people.length) return { sent: 0 };
  const [template, company] = await Promise.all([getSetting('hr.birthdayMessage', ''), getSetting('company.name', 'Ivamarg')]);
  let sent = 0;
  if (template) for (const e of people) if (await messageEmployee(e, renderTemplate(template, { nome: e.name, primeiro_nome: e.name.split(' ')[0], empresa: company }), `Feliz aniversário, ${e.name}!`)) sent++;
  await notify(await hrUsers('hr.view'), { title: `🎂 Hoje faz anos: ${people.map((e) => e.name).join(', ')}`, body: template ? `Mensagem de parabéns enviada a ${sent} de ${people.length}.` : 'Mensagem automática desligada (backoffice: RH - mensagem de aniversário).', link: '/rh/trabalhadores' });
  return { sent, birthdays: people.length };
}

/** Data de pagamento dos salários de um mês (dia configurável, no próprio mês ou no seguinte; limitado ao fim do mês). */
export function payDateOf(period: string, cfg: { day: number; nextMonth: boolean }) {
  const [y, m] = period.split('-').map(Number);
  const month = cfg.nextMonth ? m : m - 1; // índice 0-based do mês de pagamento
  const last = new Date(Date.UTC(y, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, month, Math.min(cfg.day, last)));
}

/**
 * Job diário: salários por pagar. Avisa 3 dias antes, no dia, e depois semanalmente enquanto houver valor em falta
 * (sem estado guardado: o calendário decide). Verifica o mês corrente e os dois anteriores.
 */
export async function salaryAlert(today: Date) {
  if (!(await prisma.employee.count({ where: { deletedAt: null, status: 'ACTIVE' } }))) return { alerts: 0 };
  const cfg = await getSetting('hr.payDay', { day: 25, nextMonth: false });
  let alerts = 0;
  for (const back of [0, 1, 2]) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - back - (cfg.nextMonth ? 1 : 0), 1));
    const period = iso(d).slice(0, 7);
    const payDate = payDateOf(period, cfg);
    const daysTo = Math.round((payDate.getTime() - today.getTime()) / DAY);
    if (daysTo !== 3 && !(daysTo <= 0 && -daysTo % 7 === 0)) continue;
    const run = await prisma.payrollRun.findUnique({ where: { period }, include: { payslips: { select: { net: true, paid: true } } } });
    if (run?.status === 'PAID') continue;
    const unpaid = run?.payslips.filter((p) => p.paid < p.net) ?? [];
    const title = daysTo > 0 ? `Salários de ${period}: pagamento até ${formatDate(payDate)}` : daysTo === 0 ? `Salários de ${period}: pagamento hoje` : `🔴 Salários de ${period} em atraso há ${-daysTo} dias`;
    const body = !run ? 'A folha ainda não foi gerada.' : run.status === 'DRAFT' ? 'A folha está em rascunho (por aprovar).' : `Em falta ${formatKz(unpaid.reduce((s, p) => s + p.net - p.paid, 0))} a ${unpaid.length} trabalhador(es).`;
    await notify(await hrUsers('hr.approve', 'finance.viewAll'), { title, body, link: run ? `/rh/salarios/${run.id}` : '/rh/salarios' });
    alerts++;
  }
  return { alerts };
}
