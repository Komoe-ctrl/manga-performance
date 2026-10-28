"use client";

import { use, useState } from "react";
import Link from "next/link";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { useAsync } from "@/lib/hooks/use-async";
import { getInvoiceDetail, remindInvoice, updateInvoice } from "@/lib/services";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { DateLabel, EmptyState, ErrorState, LoadingState, PageHeader, StatusBadge } from "@/components/shared";
import { InvoiceSheet } from "./invoice-sheet";

export function InvoiceDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const detail = useAsync(() => getInvoiceDetail(id));
  const [fne, setFne] = useState<string | null>(null);

  if (detail.status === "loading") return <LoadingState />;
  if (detail.status === "error") return <ErrorState message="Facture indisponible." onRetry={detail.reload} />;
  if (!detail.data) return <EmptyState message="Facture introuvable." />;

  const { invoice, client, events } = detail.data;
  const fneValue = fne ?? invoice.fneNumber ?? "";
  const canRemind = invoice.status === "en_attente" || invoice.status === "en_retard";

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Facture ${invoice.number}`}
        description={client?.companyName}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={invoice.status} />
            {canRemind && (
              <Button
                variant="outline"
                onClick={async () => {
                  await remindInvoice(invoice.id);
                  toast.success("Relance envoyée (simulation)");
                  detail.reload();
                }}
              >
                Relancer
              </Button>
            )}
            {invoice.status !== "payee" && invoice.status !== "annulee" && invoice.status !== "brouillon" && (
              <Button
                variant="outline"
                onClick={async () => {
                  await updateInvoice(invoice.id, { status: "payee" }, "Marquée comme payée");
                  toast.success("Facture marquée comme payée");
                  detail.reload();
                }}
              >
                Marquer payée
              </Button>
            )}
            <Button onClick={() => toast.info("Export PDF disponible dans la version finale")}>
              <Download className="h-4 w-4" aria-hidden /> PDF
            </Button>
          </div>
        }
      />
      <Link href="/admin/factures" className="text-sm underline">← Retour aux factures</Link>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <InvoiceSheet invoice={invoice} client={client} />
        <aside className="space-y-6">
          <form
            className="space-y-2 rounded-lg border border-border p-4"
            onSubmit={async (e) => {
              e.preventDefault();
              await updateInvoice(invoice.id, { fneNumber: fneValue.trim() || undefined }, "N° FNE renseigné");
              toast.success("N° FNE enregistré");
              setFne(null);
              detail.reload();
            }}
          >
            <Field label="N° FNE (DGI)" htmlFor="fne">
              <Input id="fne" value={fneValue} onChange={(e) => setFne(e.target.value)} placeholder="À saisir après émission sur la FNE" />
            </Field>
            <p className="text-xs text-muted-foreground">
              La facture fiscale doit être émise via la plateforme FNE de la DGI. Renseignez le numéro FNE une fois émise.
            </p>
            <Button type="submit" size="sm">Enregistrer</Button>
          </form>

          <section aria-label="Historique des statuts" className="rounded-lg border border-border p-4">
            <h2 className="mb-2 font-semibold text-primary">Historique</h2>
            <ol className="space-y-2 border-l-2 border-border pl-3 text-sm">
              {events.map((ev, i) => (
                <li key={i}>
                  <p>{ev.label}</p>
                  <p className="text-xs text-muted-foreground"><DateLabel value={ev.at} /></p>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
    </div>
  );
}
