-- AlterTable
ALTER TABLE "FinancialEntry" ADD COLUMN     "salaryPaymentId" TEXT;

-- AlterTable
ALTER TABLE "Payslip" ADD COLUMN     "paid" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "SalaryPayment" (
    "id" TEXT NOT NULL,
    "payslipId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "paidAt" DATE NOT NULL,
    "reference" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "SalaryPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SalaryPayment_payslipId_idx" ON "SalaryPayment"("payslipId");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialEntry_salaryPaymentId_key" ON "FinancialEntry"("salaryPaymentId");

-- AddForeignKey
ALTER TABLE "SalaryPayment" ADD CONSTRAINT "SalaryPayment_payslipId_fkey" FOREIGN KEY ("payslipId") REFERENCES "Payslip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

