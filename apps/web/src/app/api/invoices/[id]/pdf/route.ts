import { connection } from "next/server";
import { authErrorResponse, clientScope, requireAdminOrClient } from "@/server/auth/guards";
import { loadInvoiceDocument } from "@/server/billing/invoice-document";
import { renderInvoicePdf } from "@/server/billing/invoice-pdf";
import { getPrisma } from "@/server/db";

/**
 * Invoice PDF, generated on demand. The admin can print any invoice; a client only their
 * own, and never a draft. Anything else is a 404: the answer must not reveal that an
 * invoice of another client exists.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  try {
    const session = await requireAdminOrClient();
    const { id } = await params;
    const scope = session.role === "CLIENT" ? { ...clientScope(session), excludeDrafts: true as const } : undefined;

    const data = await loadInvoiceDocument(getPrisma(), id, scope);
    if (!data) return Response.json({ error: "NOT_FOUND" }, { status: 404 });

    const pdf = await renderInvoicePdf(data);
    const base = data.number ? `${data.isCreditNote ? "Avoir" : "Facture"}-${data.number}` : `Brouillon-${data.id.slice(0, 8)}`;
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${base}.pdf"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const response = authErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
