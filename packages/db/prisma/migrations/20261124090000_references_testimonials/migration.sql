-- CreateTable
CREATE TABLE "Reference" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sector" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "logoKey" TEXT,
    "url" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "clientAuthorization" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),
    CONSTRAINT "Reference_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "Testimonial" (
    "id" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "authorRole" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "writtenAuthorization" BOOLEAN NOT NULL DEFAULT false,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),
    CONSTRAINT "Testimonial_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "Reference_published_displayOrder_idx" ON "Reference"("published", "displayOrder");
-- CreateIndex
CREATE INDEX "Testimonial_referenceId_idx" ON "Testimonial"("referenceId");
-- CreateIndex
CREATE INDEX "Testimonial_published_idx" ON "Testimonial"("published");
-- AddForeignKey
ALTER TABLE "Testimonial" ADD CONSTRAINT "Testimonial_referenceId_fkey" FOREIGN KEY ("referenceId") REFERENCES "Reference"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A reference or a testimonial can only be public with its authorization: enforced here too, so that
-- no code path (script, console, future feature) can publish a client's name without consent.
ALTER TABLE "Reference" ADD CONSTRAINT "Reference_published_requires_authorization" CHECK (NOT "published" OR "clientAuthorization");
ALTER TABLE "Testimonial" ADD CONSTRAINT "Testimonial_published_requires_authorization" CHECK (NOT "published" OR "writtenAuthorization");

-- FELKAT, the first reference, as a draft: not published and not authorized, so invisible to the public until
-- the logo and the client's authorization are provided in /admin/references. The description is to be completed.
INSERT INTO "Reference" ("id", "name", "sector", "description", "displayOrder", "published", "clientAuthorization", "updatedAt")
SELECT gen_random_uuid()::text, 'FELKAT', 'À préciser', 'Description à compléter.', 0, false, false, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "Reference" WHERE lower("name") = 'felkat');
