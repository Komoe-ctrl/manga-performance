-- Avenant n°1, étape B1 : rôles client multiples et modèle de données de la collecte.

-- 1. Role : CLIENT devient CLIENT_DIRECTION ; deux rôles s'ajoutent. Les valeurs d'une énumération
--    ne peuvent pas être utilisées dans la transaction qui les crée : on recrée donc le type.
CREATE TYPE "Role_new" AS ENUM ('ADMIN', 'CLIENT_DIRECTION', 'CLIENT_CONTRIBUTEUR', 'CLIENT_ANALYSTE');

ALTER TABLE "User" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "role" TYPE "Role_new"
  USING (CASE "role"::text WHEN 'CLIENT' THEN 'CLIENT_DIRECTION' ELSE "role"::text END)::"Role_new";
ALTER TABLE "Message" ALTER COLUMN "fromRole" TYPE "Role_new"
  USING (CASE "fromRole"::text WHEN 'CLIENT' THEN 'CLIENT_DIRECTION' ELSE "fromRole"::text END)::"Role_new";
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'CLIENT_DIRECTION';

DROP TYPE "Role";
ALTER TYPE "Role_new" RENAME TO "Role";

-- 2. Module collecte
CREATE TYPE "Sector" AS ENUM ('BTP', 'HOTELLERIE', 'RESTAURATION', 'COMMERCE', 'TECH_FINTECH');
CREATE TYPE "CollectionFrequency" AS ENUM ('HEBDOMADAIRE', 'MENSUELLE');
CREATE TYPE "PeriodStatus" AS ENUM ('A_VENIR', 'ATTENDU', 'EN_RETARD', 'EN_CONTROLE', 'REJETE', 'VALIDE', 'ACCEPTE_AVEC_RESERVE');
CREATE TYPE "SubmissionStatus" AS ENUM ('EN_CONTROLE', 'REJETE', 'VALIDE', 'ACCEPTE_AVEC_RESERVE', 'ERREUR_TECHNIQUE');

CREATE TABLE "Entity" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sector" "Sector" NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'XOF',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Entity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EntityAssignment" (
    "userId" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,

    CONSTRAINT "EntityAssignment_pkey" PRIMARY KEY ("userId","entityId")
);

CREATE TABLE "CollectionPlan" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "frequency" "CollectionFrequency" NOT NULL DEFAULT 'MENSUELLE',
    "delayDays" INTEGER NOT NULL DEFAULT 3,
    "startsOn" TIMESTAMPTZ(3) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CollectionPlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CollectionPeriod" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "periodStart" TIMESTAMPTZ(3) NOT NULL,
    "periodEnd" TIMESTAMPTZ(3) NOT NULL,
    "dueAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "PeriodStatus" NOT NULL DEFAULT 'ATTENDU',
    "remindersSent" INTEGER NOT NULL DEFAULT 0,
    "lastReminderAt" TIMESTAMPTZ(3),

    CONSTRAINT "CollectionPeriod_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Submission" (
    "id" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "templateId" TEXT NOT NULL,
    "templateVersion" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "uploadedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'EN_CONTROLE',
    "report" JSONB,
    "rows" JSONB,
    "rowCount" INTEGER,
    "reviewComment" TEXT,
    "reviewedBy" TEXT,

    CONSTRAINT "Submission_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Entity_clientId_name_key" ON "Entity"("clientId", "name");
CREATE INDEX "EntityAssignment_entityId_idx" ON "EntityAssignment"("entityId");
CREATE UNIQUE INDEX "CollectionPlan_entityId_templateId_key" ON "CollectionPlan"("entityId", "templateId");
CREATE INDEX "CollectionPeriod_status_dueAt_idx" ON "CollectionPeriod"("status", "dueAt");
CREATE UNIQUE INDEX "CollectionPeriod_planId_periodStart_key" ON "CollectionPeriod"("planId", "periodStart");
CREATE UNIQUE INDEX "Submission_storageKey_key" ON "Submission"("storageKey");
CREATE UNIQUE INDEX "Submission_periodId_version_key" ON "Submission"("periodId", "version");

ALTER TABLE "Entity" ADD CONSTRAINT "Entity_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EntityAssignment" ADD CONSTRAINT "EntityAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EntityAssignment" ADD CONSTRAINT "EntityAssignment_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CollectionPlan" ADD CONSTRAINT "CollectionPlan_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "Entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CollectionPeriod" ADD CONSTRAINT "CollectionPeriod_planId_fkey" FOREIGN KEY ("planId") REFERENCES "CollectionPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "CollectionPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
