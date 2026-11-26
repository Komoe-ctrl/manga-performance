-- Pilot results become visible to the client only after the consultant validates them (avenant n°1, §10).

-- AlterTable
ALTER TABLE "CpraResult" ADD COLUMN "validatedAt" TIMESTAMPTZ(3),
ADD COLUMN "validatedBy" TEXT;

-- CreateIndex
CREATE INDEX "CpraResult_periodId_version_idx" ON "CpraResult"("periodId", "version");

-- AlterTable
ALTER TABLE "HotelKpiResult" ADD COLUMN "validatedAt" TIMESTAMPTZ(3),
ADD COLUMN "validatedBy" TEXT;

-- CreateIndex
CREATE INDEX "HotelKpiResult_submissionId_version_idx" ON "HotelKpiResult"("submissionId", "version");
