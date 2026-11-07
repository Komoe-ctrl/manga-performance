"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useAsync } from "@/lib/hooks/use-async";
import { USE_DB, invoiceTotals, listClients, listInvoices, publishDeliverable, setClientAccess } from "@/lib/services";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { ErrorState, LoadingState, MoneyAmount } from "@/components/shared";
import { DataTable, type Column } from "@/components/shared/data-table";

interface Row {
  id: string;
  companyName: string;
  contactName: string;
  accessActive: boolean;
  deliverablesCount: number;
  billed: number;
}

function PublishDialog({ client, onClose, onDone }: { client: Row | null; onClose: () => void; onDone: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState("");
  const [fileType, setFileType] = useState<"pdf" | "xlsx">("pdf");
  const [file, setFile] = useState<File | undefined>();
  const [publishing, setPublishing] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (client && !d.open) d.showModal();
    if (!client && d.open) d.close();
  }, [client]);

  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby="pub-title" className="m-auto w-[calc(100%-2rem)] max-w-md rounded-lg p-6 backdrop:bg-black/50">
      <h2 id="pub-title" className="font-bold text-primary">Publier un livrable — {client?.companyName}</h2>
      <form
        className="mt-4 space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!client || !title.trim()) return;
          setPublishing(true);
          try {
            // Mode maquette : taille aléatoire, aucun fichier réel. Mode base : le fichier est envoyé au stockage privé.
            await publishDeliverable({ clientId: client.id, title: title.trim(), fileType, sizeKb: 120 + Math.floor(Math.random() * 600), file });
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Publication impossible, réessayez.");
            return;
          } finally {
            setPublishing(false);
          }
          toast.success("Livrable publié dans l'espace client");
          setTitle("");
          setFile(undefined);
          onDone();
          onClose();
        }}
      >
        <Field label="Titre *" htmlFor="pub-name">
          <Input id="pub-name" value={title} onChange={(e) => setTitle(e.target.value)} required />
        </Field>
        {USE_DB ? (
          <Field label="Fichier * (PDF, Excel, Word, PNG ou JPG, 25 Mo max)" htmlFor="pub-file">
            <Input id="pub-file" type="file" accept=".pdf,.xlsx,.docx,.png,.jpg,.jpeg" required onChange={(e) => setFile(e.target.files?.[0])} />
          </Field>
        ) : (
          <>
            <Field label="Type de fichier" htmlFor="pub-type">
              <Select id="pub-type" value={fileType} onChange={(e) => setFileType(e.target.value as "pdf" | "xlsx")}>
                <option value="pdf">PDF</option>
                <option value="xlsx">Excel (XLSX)</option>
              </Select>
            </Field>
            <p className="text-xs text-muted-foreground">Téléversement simulé : aucun fichier n&apos;est réellement envoyé.</p>
          </>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Annuler</Button>
          <Button type="submit" disabled={publishing}>Publier</Button>
        </div>
      </form>
    </dialog>
  );
}

export function ClientsView() {
  const data = useAsync(async () => ({ clients: await listClients(), invoices: await listInvoices() }));
  const [publishing, setPublishing] = useState<Row | null>(null);

  if (data.status === "loading") return <LoadingState />;
  if (data.status === "error") return <ErrorState message="Clients indisponibles." onRetry={data.reload} />;

  const rows: Row[] = data.data.clients.map((c) => ({
    id: c.id,
    companyName: c.companyName,
    contactName: c.contactName,
    accessActive: c.accessActive,
    deliverablesCount: c.deliverablesCount,
    billed: data.data.invoices
      .filter((i) => i.clientId === c.id && i.status !== "annulee" && i.status !== "brouillon")
      .reduce((s, i) => s + invoiceTotals(i).ttc, 0),
  }));

  const columns: Column<Row>[] = [
    {
      id: "companyName",
      header: "Client",
      sortValue: (r) => r.companyName,
      cell: (r) => <Link href={`/admin/prospects/${r.id}`} className="font-medium hover:underline">{r.companyName}</Link>,
    },
    { id: "contactName", header: "Contact", sortValue: (r) => r.contactName, cell: (r) => r.contactName },
    {
      id: "access",
      header: "Accès espace client",
      sortValue: (r) => Number(r.accessActive),
      cell: (r) => (
        <button
          type="button"
          role="switch"
          aria-checked={r.accessActive}
          aria-label={`Accès à l'espace client de ${r.companyName}`}
          onClick={async () => {
            await setClientAccess(r.id, !r.accessActive);
            toast.success(r.accessActive ? "Accès désactivé" : "Accès activé");
            data.reload();
          }}
          className="group inline-flex items-center gap-2 rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          <span className={cn("relative h-5 w-9 rounded-full transition-colors", r.accessActive ? "bg-success" : "bg-slate-300")} aria-hidden>
            <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all", r.accessActive ? "left-[18px]" : "left-0.5")} />
          </span>
          <span className={cn("text-sm", r.accessActive ? "font-medium text-success" : "text-muted-foreground")}>{r.accessActive ? "Actif" : "Inactif"}</span>
        </button>
      ),
    },
    { id: "deliverables", header: "Livrables", sortValue: (r) => r.deliverablesCount, cell: (r) => r.deliverablesCount },
    { id: "billed", header: "CA facturé", sortValue: (r) => r.billed, cell: (r) => <MoneyAmount value={r.billed} /> },
    {
      id: "actions",
      header: "Actions",
      cell: (r) => <Button size="sm" variant="outline" onClick={() => setPublishing(r)}>Publier un livrable</Button>,
    },
  ];

  return (
    <>
      <DataTable data={rows} columns={columns} getRowId={(r) => r.id} caption="Liste des clients" emptyMessage="Aucun client pour l'instant." />
      <PublishDialog client={publishing} onClose={() => setPublishing(null)} onDone={data.reload} />
    </>
  );
}
