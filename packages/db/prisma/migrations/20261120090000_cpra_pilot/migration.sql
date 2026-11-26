-- CreateTable
CREATE TABLE "ClientProduct" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "referenceUnit" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ClientProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductConversion" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "deliveryUnit" TEXT NOT NULL,
    "factor" DECIMAL(14,4),

    CONSTRAINT "ProductConversion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CpraNorm" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "entityId" TEXT,
    "validFrom" TIMESTAMPTZ(3) NOT NULL,
    "normPerClient" DECIMAL(14,4) NOT NULL,
    "nonUserRate" DECIMAL(5,4) NOT NULL DEFAULT 0,
    "unitCostFcfa" DECIMAL(14,4) NOT NULL,

    CONSTRAINT "CpraNorm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntityCpraSetting" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "validFrom" TIMESTAMPTZ(3) NOT NULL,
    "longStayFactor" DECIMAL(6,4) NOT NULL,

    CONSTRAINT "EntityCpraSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CpraResult" (
    "id" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "cproRef" DECIMAL(18,4),
    "cpra" DECIMAL(18,4) NOT NULL,
    "ecartVolume" DECIMAL(18,4),
    "couverture" DECIMAL(8,4),
    "ecartValorise" INTEGER,
    "status" TEXT NOT NULL,
    "paramsSnapshot" JSONB NOT NULL,
    "note" TEXT,
    "computedBy" TEXT,
    "computedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL,

    CONSTRAINT "CpraResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClientProduct_clientId_code_key" ON "ClientProduct"("clientId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ClientProduct_clientId_label_key" ON "ClientProduct"("clientId", "label");

-- CreateIndex
CREATE UNIQUE INDEX "ProductConversion_productId_deliveryUnit_key" ON "ProductConversion"("productId", "deliveryUnit");

-- CreateIndex
CREATE INDEX "CpraNorm_productId_entityId_validFrom_idx" ON "CpraNorm"("productId", "entityId", "validFrom");

-- CreateIndex
CREATE UNIQUE INDEX "EntityCpraSetting_entityId_validFrom_key" ON "EntityCpraSetting"("entityId", "validFrom");

-- CreateIndex
CREATE INDEX "CpraResult_submissionId_idx" ON "CpraResult"("submissionId");

-- CreateIndex
CREATE UNIQUE INDEX "CpraResult_periodId_productId_version_key" ON "CpraResult"("periodId", "productId", "version");

-- AddForeignKey
ALTER TABLE "ClientProduct" ADD CONSTRAINT "ClientProduct_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductConversion" ADD CONSTRAINT "ProductConversion_productId_fkey" FOREIGN KEY ("productId") REFERENCES "ClientProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CpraNorm" ADD CONSTRAINT "CpraNorm_productId_fkey" FOREIGN KEY ("productId") REFERENCES "ClientProduct"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CpraNorm" ADD CONSTRAINT "CpraNorm_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityCpraSetting" ADD CONSTRAINT "EntityCpraSetting_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CpraResult" ADD CONSTRAINT "CpraResult_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "CollectionPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CpraResult" ADD CONSTRAINT "CpraResult_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CpraResult" ADD CONSTRAINT "CpraResult_productId_fkey" FOREIGN KEY ("productId") REFERENCES "ClientProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

