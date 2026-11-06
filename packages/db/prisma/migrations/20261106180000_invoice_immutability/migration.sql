-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "remindersDisabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_creditNoteOfId_key" ON "Invoice"("creditNoteOfId");

-- ---------------------------------------------------------------------------
-- Issued invoices are immutable (spec, 6.4). The application enforces it, and the
-- database backs it up: no code path, script or manual query can rewrite an issued
-- invoice. A correction is a credit note followed by a new invoice.
-- ---------------------------------------------------------------------------

-- A draft has no number; every other status has one.
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_number_matches_status"
  CHECK (("status" = 'BROUILLON' AND "number" IS NULL) OR ("status" <> 'BROUILLON' AND "number" IS NOT NULL));

CREATE OR REPLACE FUNCTION invoice_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."number" IS NOT NULL OR OLD."status" <> 'BROUILLON' THEN
      RAISE EXCEPTION 'invoice % is issued and cannot be deleted', COALESCE(OLD."number", OLD."id")
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD."number" IS NOT NULL THEN
    IF NEW."number" IS DISTINCT FROM OLD."number"
       OR NEW."clientId" IS DISTINCT FROM OLD."clientId"
       OR NEW."vatRate" IS DISTINCT FROM OLD."vatRate"
       OR NEW."totalHt" IS DISTINCT FROM OLD."totalHt"
       OR NEW."totalVat" IS DISTINCT FROM OLD."totalVat"
       OR NEW."totalTtc" IS DISTINCT FROM OLD."totalTtc"
       OR NEW."issuedAt" IS DISTINCT FROM OLD."issuedAt"
       OR NEW."dueAt" IS DISTINCT FROM OLD."dueAt"
       OR NEW."creditNoteOfId" IS DISTINCT FROM OLD."creditNoteOfId"
       OR NEW."status" = 'BROUILLON' THEN
      RAISE EXCEPTION 'invoice % is issued and cannot be modified', OLD."number"
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "Invoice_guard"
  BEFORE UPDATE OR DELETE ON "Invoice"
  FOR EACH ROW EXECUTE FUNCTION invoice_guard();

-- Lines can only change while their invoice is still a draft.
CREATE OR REPLACE FUNCTION invoice_line_guard() RETURNS trigger AS $$
DECLARE
  current_status text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    SELECT "status"::text INTO current_status FROM "Invoice" WHERE "id" = OLD."invoiceId";
    IF current_status IS NOT NULL AND current_status <> 'BROUILLON' THEN
      RAISE EXCEPTION 'lines of an issued invoice cannot be modified'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    SELECT "status"::text INTO current_status FROM "Invoice" WHERE "id" = NEW."invoiceId";
    IF current_status IS NOT NULL AND current_status <> 'BROUILLON' THEN
      RAISE EXCEPTION 'lines of an issued invoice cannot be modified'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "InvoiceLine_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "InvoiceLine"
  FOR EACH ROW EXECUTE FUNCTION invoice_line_guard();
