import multipart from '@fastify/multipart';
import { attendanceSheetSchema, biometricImportSchema, salaryPaymentSchema, employeeSchema, leaveSchema, listQuerySchema, MAX_UPLOAD_MB, payslipUpdateSchema } from '@ivamarg/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit, ctxOf } from '../../lib/audit';
import { readUpload } from '../documents/routes';
import { payslipsPdf } from './pdf';
import * as hr from './service';

type Id = { Params: { id: string } };
const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mês inválido (AAAA-MM)');

export async function hrRoutes(app: FastifyInstance) {
  await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 1 }, throwFileSizeLimit: false });
  const view = { preHandler: app.guard('hr.view') };
  const create = { preHandler: app.guard('hr.create') };
  const edit = { preHandler: app.guard('hr.edit') };
  const approve = { preHandler: app.guard('hr.approve') };

  app.get('/employees', view, (req) => hr.listEmployees(listQuerySchema.extend({ status: z.string().optional(), department: z.string().optional() }).parse(req.query)));
  app.get<Id>('/employees/:id', view, (req) => hr.getEmployee(req.params.id));
  app.post('/employees', create, (req) => hr.createEmployee(ctxOf(req), employeeSchema.parse(req.body)));
  app.patch<Id>('/employees/:id', edit, (req) => hr.updateEmployee(ctxOf(req), req.params.id, employeeSchema.partial().parse(req.body)));
  app.delete<Id>('/employees/:id', { preHandler: app.guard('hr.delete') }, async (req, reply) => {
    await hr.deleteEmployee(ctxOf(req), req.params.id);
    return reply.code(204).send();
  });

  app.get('/attendance', view, (req) => hr.attendanceSheet(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(req.query).date));
  app.put('/attendance', edit, (req) => hr.saveAttendance(ctxOf(req), attendanceSheetSchema.parse(req.body)));
  // Marcações já lidas no browser (CSV/Excel do relógio); ficheiros de vários meses passam do limite padrão de 1 MB.
  app.post('/attendance/import', { ...edit, bodyLimit: 30 * 1024 * 1024 }, (req) => hr.importBiometric(ctxOf(req), biometricImportSchema.parse(req.body)));
  app.get('/attendance/month', view, (req) => hr.attendanceMonth(z.object({ period }).parse(req.query).period));

  app.get('/leaves', view, (req) => hr.listLeaves(listQuerySchema.extend({ status: z.string().optional(), employeeId: z.string().optional() }).parse(req.query)));
  app.post('/leaves', create, (req) => hr.createLeave(ctxOf(req), leaveSchema.parse(req.body)));
  app.post<Id>('/leaves/:id/decision', approve, (req) => {
    const b = z.object({ status: z.enum(['APPROVED', 'REJECTED', 'CANCELLED']), comment: z.string().trim().optional().nullable().transform((v) => v || null) }).parse(req.body);
    return hr.decideLeave(ctxOf(req), req.params.id, b.status, b.comment);
  });

  app.post<Id>('/leaves/:id/attachment', { ...create, bodyLimit: (MAX_UPLOAD_MB + 1) * 1024 * 1024 }, async (req) => hr.attachLeaveFile(ctxOf(req), req.params.id, (await readUpload(req)).file));
  app.get<Id>('/leaves/:id/attachment', view, (req) => hr.leaveFileUrl(ctxOf(req), req.params.id));

  app.get('/payroll', view, () => hr.listRuns());
  app.get<Id>('/payroll/:id', view, (req) => hr.getRun(req.params.id));
  app.post('/payroll', edit, (req) => hr.generateRun(ctxOf(req), z.object({ period }).parse(req.body).period));
  app.patch<Id>('/payslips/:id', edit, (req) => hr.updatePayslip(ctxOf(req), req.params.id, payslipUpdateSchema.parse(req.body)));
  app.post<Id>('/payroll/:id/status', approve, (req) => hr.setRunStatus(ctxOf(req), req.params.id, z.object({ status: z.enum(['APPROVED', 'DRAFT']) }).parse(req.body).status));
  app.post<Id>('/payroll/:id/payments', approve, (req) => hr.paySalaries(ctxOf(req), req.params.id, salaryPaymentSchema.parse(req.body)));
  app.post<Id>('/salary-payments/:id/cancel', approve, (req) => hr.cancelSalaryPayment(ctxOf(req), req.params.id));
  app.get<Id & { Querystring: { employeeId?: string } }>('/payroll/:id/pdf', { preHandler: app.guard('hr.export') }, async (req, reply) => {
    const run = await hr.getRun(req.params.id);
    await audit(ctxOf(req), { entity: 'PayrollRun', entityId: run.id, action: 'pdf', after: { employeeId: req.query.employeeId } });
    return reply.type('application/pdf').header('Content-Disposition', `inline; filename="recibos-${run.period}.pdf"`).send(await payslipsPdf(run, req.query.employeeId));
  });
}
