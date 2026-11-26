-- CreateTable
CREATE TABLE "HotelKpiResult" (
    "id" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "kpis" JSONB NOT NULL,
    "alerts" JSONB NOT NULL,
    "previous" JSONB,
    "paramsSnapshot" JSONB NOT NULL,
    "note" TEXT,
    "computedBy" TEXT,
    "computedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HotelKpiResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HotelKpiResult_submissionId_idx" ON "HotelKpiResult"("submissionId");

-- CreateIndex
CREATE UNIQUE INDEX "HotelKpiResult_periodId_version_key" ON "HotelKpiResult"("periodId", "version");

-- AddForeignKey
ALTER TABLE "HotelKpiResult" ADD CONSTRAINT "HotelKpiResult_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "CollectionPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HotelKpiResult" ADD CONSTRAINT "HotelKpiResult_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
