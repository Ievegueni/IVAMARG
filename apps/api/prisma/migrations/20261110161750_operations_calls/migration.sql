-- AlterTable
ALTER TABLE "Borehole" ADD COLUMN     "crew" TEXT,
ADD COLUMN     "endDate" DATE,
ADD COLUMN     "gps" TEXT,
ADD COLUMN     "managerId" TEXT,
ADD COLUMN     "result" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "startDate" DATE,
ADD COLUMN     "team" TEXT[];

-- AlterTable
ALTER TABLE "Contract" ADD COLUMN     "visitDays" INTEGER[],
ADD COLUMN     "visitTeam" TEXT,
ADD COLUMN     "visitTime" TEXT;

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "callConsentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "crew" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "endDate" DATE,
ADD COLUMN     "location" TEXT,
ADD COLUMN     "managerId" TEXT,
ADD COLUMN     "startDate" DATE,
ADD COLUMN     "team" TEXT[];

-- CreateTable
CREATE TABLE "ProjectPhase" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "boreholeId" TEXT,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "budget" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "plannedStart" DATE,
    "plannedEnd" DATE,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "ProjectPhase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceVisit" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "team" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "executedAt" TIMESTAMP(3),
    "notes" TEXT,
    "checklist" JSONB NOT NULL DEFAULT '[]',
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallLog" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "externalId" TEXT,
    "direction" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RINGING',
    "offerSdp" TEXT,
    "answerSdp" TEXT,
    "userId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "durationSec" INTEGER,
    "result" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CallLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectPhase_projectId_idx" ON "ProjectPhase"("projectId");

-- CreateIndex
CREATE INDEX "ProjectPhase_boreholeId_idx" ON "ProjectPhase"("boreholeId");

-- CreateIndex
CREATE INDEX "ServiceVisit_scheduledAt_idx" ON "ServiceVisit"("scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceVisit_contractId_scheduledAt_key" ON "ServiceVisit"("contractId", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "CallLog_externalId_key" ON "CallLog"("externalId");

-- CreateIndex
CREATE INDEX "CallLog_conversationId_idx" ON "CallLog"("conversationId");

-- CreateIndex
CREATE INDEX "CallLog_status_idx" ON "CallLog"("status");

-- AddForeignKey
ALTER TABLE "ProjectPhase" ADD CONSTRAINT "ProjectPhase_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectPhase" ADD CONSTRAINT "ProjectPhase_boreholeId_fkey" FOREIGN KEY ("boreholeId") REFERENCES "Borehole"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceVisit" ADD CONSTRAINT "ServiceVisit_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallLog" ADD CONSTRAINT "CallLog_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallLog" ADD CONSTRAINT "CallLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
