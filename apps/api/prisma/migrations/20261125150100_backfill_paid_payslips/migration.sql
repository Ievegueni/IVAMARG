-- Folhas já marcadas como pagas antes dos pagamentos parcelados: recibos totalmente pagos.
UPDATE "Payslip" p SET "paid" = p."net" FROM "PayrollRun" r WHERE r."id" = p."runId" AND r."status" = 'PAID';
