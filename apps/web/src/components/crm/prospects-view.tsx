"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Download, LayoutGrid, Plus, Table2 } from "lucide-react";
import { toast } from "sonner";
import { useAsync } from "@/lib/hooks/use-async";
import { listProspects } from "@/lib/services";
import { NEED_LABELS, SECTORS, SIZE_LABELS, SOURCE_LABELS, STATUS_LABELS, STATUS_ORDER } from "@/lib/constants";
import type { Prospect } from "@/lib/types";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { DateLabel, ErrorState, LoadingState, StatusBadge } from "@/components/shared";
import { DataTable, type Column } from "@/components/shared/data-table";
import { Kanban } from "./kanban";
import { ProspectPanel } from "./prospect-panel";

interface Filters {
  q: string;
  status: string;
  sector: string;
  size: string;
  need: string;
  source: string;
}
const EMPTY: Filters = { q: "", status: "", sector: "", size: "", need: "", source: "" };

const columns: Column<Prospect>[] = [
  {
    id: "companyName",
    header: "Entreprise",
    sortValue: (p) => p.companyName,
    cell: (p) => (
      <Link href={`/admin/prospects/${p.id}`} className="font-medium hover:underline">
        {p.companyName}
      </Link>
    ),
  },
  { id: "contactName", header: "Contact", sortValue: (p) => p.contactName, cell: (p) => p.contactName },
  { id: "sector", header: "Secteur", sortValue: (p) => p.sector, cell: (p) => p.sector },
  { id: "city", header: "Ville", sortValue: (p) => p.city, cell: (p) => p.city },
  { id: "need", header: "Besoin", sortValue: (p) => NEED_LABELS[p.need], cell: (p) => NEED_LABELS[p.need] },
  { id: "status", header: "Statut", sortValue: (p) => STATUS_ORDER.indexOf(p.status), cell: (p) => <StatusBadge status={p.status} /> },
  { id: "source", header: "Source", sortValue: (p) => SOURCE_LABELS[p.source], cell: (p) => SOURCE_LABELS[p.source] },
  {
    id: "nextFollowUpAt",
    header: "Prochaine relance",
    sortValue: (p) => p.nextFollowUpAt ?? "",
    cell: (p) => (p.nextFollowUpAt ? <DateLabel value={p.nextFollowUpAt} /> : "—"),
  },
];

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <label className="text-xs">
      <span className="mb-1 block font-medium">{label}</span>
      <Select className="h-9" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Tous</option>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </Select>
    </label>
  );
}

export function ProspectsView() {
  const prospects = useAsync(listProspects);
  const [view, setView] = useState<"table" | "kanban">("table");
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [selected, setSelected] = useState<string[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);

  const set = (k: keyof Filters) => (v: string) => setFilters((f) => ({ ...f, [k]: v }));

  const rows = useMemo(() => {
    if (prospects.status !== "success") return [];
    const q = filters.q.trim().toLowerCase();
    return prospects.data.filter(
      (p) =>
        (!filters.status || p.status === filters.status) &&
        (!filters.sector || p.sector === filters.sector) &&
        (!filters.size || p.size === filters.size) &&
        (!filters.need || p.need === filters.need) &&
        (!filters.source || p.source === filters.source) &&
        (!q || [p.companyName, p.contactName, p.email, p.sector, p.city].some((v) => v?.toLowerCase().includes(q))),
    );
  }, [prospects, filters]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Mode d'affichage" className="flex overflow-hidden rounded-md border border-border">
          {([["table", "Tableau", Table2], ["kanban", "Kanban", LayoutGrid]] as const).map(([v, label, Icon]) => (
            <button
              key={v}
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={cn("flex items-center gap-1 px-3 py-2 text-sm", view === v ? "bg-primary text-primary-foreground" : "hover:bg-muted")}
            >
              <Icon className="h-4 w-4" aria-hidden /> {label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => toast.info("Export Excel disponible dans la version finale")}>
            <Download className="h-4 w-4" aria-hidden /> Excel
          </Button>
          <Button variant="outline" onClick={() => toast.info("Export PDF disponible dans la version finale")}>
            <Download className="h-4 w-4" aria-hidden /> PDF
          </Button>
          <Button onClick={() => setPanelOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden /> Nouveau prospect
          </Button>
        </div>
      </div>

      <div className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-3 lg:grid-cols-6">
        <label className="text-xs sm:col-span-3 lg:col-span-6">
          <span className="mb-1 block font-medium">Recherche</span>
          <Input type="search" placeholder="Entreprise, contact, email, ville…" value={filters.q} onChange={(e) => set("q")(e.target.value)} />
        </label>
        <FilterSelect label="Statut" value={filters.status} onChange={set("status")} options={STATUS_ORDER.map((s) => [s, STATUS_LABELS[s]])} />
        <FilterSelect label="Secteur" value={filters.sector} onChange={set("sector")} options={SECTORS.map((s) => [s, s])} />
        <FilterSelect label="Taille" value={filters.size} onChange={set("size")} options={Object.entries(SIZE_LABELS)} />
        <FilterSelect label="Besoin" value={filters.need} onChange={set("need")} options={Object.entries(NEED_LABELS)} />
        <FilterSelect label="Source" value={filters.source} onChange={set("source")} options={Object.entries(SOURCE_LABELS)} />
        <div className="flex items-end">
          <Button variant="ghost" size="sm" onClick={() => setFilters(EMPTY)}>Réinitialiser</Button>
        </div>
      </div>

      {selected.length > 0 && view === "table" && (
        <p role="status" className="text-sm">{selected.length} prospect(s) sélectionné(s)</p>
      )}

      {prospects.status === "loading" && <LoadingState />}
      {prospects.status === "error" && <ErrorState message="Impossible de charger les prospects." onRetry={prospects.reload} />}
      {prospects.status === "success" &&
        (view === "table" ? (
          <DataTable
            data={rows}
            columns={columns}
            getRowId={(p) => p.id}
            selectable
            onSelectionChange={setSelected}
            caption="Liste des prospects"
            emptyMessage="Aucun prospect ne correspond aux filtres."
          />
        ) : (
          <Kanban prospects={rows} onChanged={prospects.reload} />
        ))}

      <ProspectPanel open={panelOpen} onClose={() => setPanelOpen(false)} onCreated={prospects.reload} />
    </div>
  );
}
