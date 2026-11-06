"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useAsync } from "@/lib/hooks/use-async";
import { invoiceTotals, listInvoices, listProspects, remindInvoice } from "@/lib/services";
import type { Invoice, InvoiceStatus } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { DateLabel, ErrorState, KpiCard, LoadingState, MoneyAmount, StatusBadge } from "@/components/shared";
import { DataTable, type Column } from "@/components/shared/data-table";
import { formatFCFA } from "@/lib/utils/format";

const STATUSES: [InvoiceStatus, string][] = [
  ["brouillon", "Brouillon"],
  ["emise", "Émise"],
  ["en_attente", "En attente"],
  ["en_retard", "En retard"],
  ["payee", "Payée"],
  ["annulee", "Annulée"],
];

interface Row extends Invoice {
  clientName: string;
  ttc: number;
}

export function InvoicesList() {
  const data = useAsync(async () => ({ invoices: await listInvoices(), prospects: await listProspects() }));
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const rows: Row[] = useMemo(() => {
    if (data.status !== "success") return [];
    const names = new Map(data.data.prospects.map((p) => [p.id, p.companyName]));
    return data.data.invoices
      .map((i) => ({ ...i, clientName: names.get(i.clientId) ?? "—", ttc: invoiceTotals(i).ttc }))
      .filter(
        (i) =>
          (!status || i.status === status) &&
          (!from || i.issuedAt.slice(0, 10) >= from) &&
          (!to || i.issuedAt.slice(0, 10) <= to),
      )
      .sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
  }, [data, status, from, to]);

  if (data.status === "loading") return <LoadingState />;
  if (data.status === "error") return <ErrorState message="Factures indisponibles." onRetry={data.reload} />;

  const sum = (pred: (r: Row) => boolean) => rows.filter(pred).reduce((s, r) => s + r.ttc, 0);
  const issued = sum((r) => r.status !== "brouillon" && r.status !== "annulee");

  const columns: Column<Row>[] = [
    {
      id: "number",
      header: "N°",
      sortValue: (r) => r.number,
      cell: (r) => <Link href={`/admin/factures/${r.id}`} className="font-medium hover:underline">{r.number}</Link>,
    },
    { id: "client", header: "Client", sortValue: (r) => r.clientName, cell: (r) => r.clientName },
    { id: "issuedAt", header: "Émise le", sortValue: (r) => r.issuedAt, cell: (r) => <DateLabel value={r.issuedAt} /> },
    { id: "dueAt", header: "Échéance", sortValue: (r) => r.dueAt, cell: (r) => <DateLabel value={r.dueAt} /> },
    { id: "ttc", header: "Montant TTC", sortValue: (r) => r.ttc, cell: (r) => <MoneyAmount value={r.ttc} /> },
    { id: "status", header: "Statut", sortValue: (r) => r.status, cell: (r) => <StatusBadge status={r.status} /> },
    { id: "reminders", header: "Relances", sortValue: (r) => r.remindersSent, cell: (r) => r.remindersSent },
    {
      id: "actions",
      header: "Action",
      cell: (r) =>
        r.status === "en_attente" || r.status === "en_retard" ? (
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              await remindInvoice(r.id);
              toast.success(`Relance envoyée à ${r.clientName} (simulation)`);
              data.reload();
            }}
          >
            Relancer
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-4">
      <section aria-label="Totaux" className="grid gap-4 sm:grid-cols-3">
        <KpiCard label="Émis" value={formatFCFA(issued)} />
        <KpiCard label="Encaissé" value={formatFCFA(sum((r) => r.status === "payee"))} />
        <KpiCard label="En retard" value={formatFCFA(sum((r) => r.status === "en_retard"))} />
      </section>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs">
          <span className="mb-1 block font-medium">Statut</span>
          <Select className="h-9" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Tous</option>
            {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
        </label>
        <label className="text-xs">
          <span className="mb-1 block font-medium">Du</span>
          <Input className="h-9" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="text-xs">
          <span className="mb-1 block font-medium">Au</span>
          <Input className="h-9" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <Button variant="ghost" size="sm" onClick={() => { setStatus(""); setFrom(""); setTo(""); }}>
          Réinitialiser
        </Button>
      </div>

      <DataTable data={rows} columns={columns} getRowId={(r) => r.id} caption="Liste des factures" emptyMessage="Aucune facture ne correspond aux filtres." />
    </div>
  );
}
