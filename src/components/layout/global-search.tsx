"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Search } from "lucide-react";
import { useAsync } from "@/lib/hooks/use-async";
import { listInvoices, listProspects } from "@/lib/services";

/** Recherche globale du back-office : prospects et factures. */
export function GlobalSearch() {
  const [entry, setEntry] = useState({ q: "", path: "" });
  const [enabled, setEnabled] = useState(false);
  const pathname = usePathname();
  const data = useAsync(async () => (enabled ? { prospects: await listProspects(), invoices: await listInvoices() } : null), [enabled]);

  // la saisie est abandonnée dès que l'on change de page
  const q = entry.path === pathname ? entry.q : "";
  const setQ = (value: string) => setEntry({ q: value, path: pathname });

  const term = q.trim().toLowerCase();
  const results =
    term.length >= 2 && data.status === "success" && data.data
      ? {
          prospects: data.data.prospects.filter((p) => [p.companyName, p.contactName, p.email].some((v) => v?.toLowerCase().includes(term))).slice(0, 5),
          invoices: data.data.invoices.filter((i) => i.number.includes(term)).slice(0, 3),
        }
      : null;

  return (
    <div className="relative max-w-md flex-1" onKeyDown={(e) => e.key === "Escape" && setQ("")}>
      <label>
        <span className="sr-only">Recherche globale</span>
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
        <input
          type="search"
          value={q}
          onFocus={() => setEnabled(true)}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Rechercher un prospect, une facture…"
          className="h-9 w-full rounded-md border border-border pl-9 pr-3 text-sm"
        />
      </label>
      {results && (
        <div className="absolute left-0 right-0 top-11 z-40 rounded-md border border-border bg-background p-2 text-sm shadow-lg" aria-live="polite">
          {results.prospects.length + results.invoices.length === 0 && <p className="p-2 text-muted-foreground">Aucun résultat.</p>}
          {results.prospects.map((p) => (
            <Link key={p.id} href={`/admin/prospects/${p.id}`} className="block rounded px-2 py-1.5 hover:bg-muted">
              {p.companyName} <span className="text-xs text-muted-foreground">— prospect</span>
            </Link>
          ))}
          {results.invoices.map((i) => (
            <Link key={i.id} href={`/admin/factures/${i.id}`} className="block rounded px-2 py-1.5 hover:bg-muted">
              Facture {i.number}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
