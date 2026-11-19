"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarClock, Download, FileSpreadsheet, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { useAsync } from "@/lib/hooks/use-async";
import { dueLabel, exportUrl, getClientCollection, monthKey, periodLabel, submitDeposit, templateUrl, VIEWER_ROLE_LABELS, type CollectionViewerRole } from "@/lib/services/collection";
import { USE_DB } from "@/lib/services/data-source";
import { type CollectionPeriod, type TrackingRow } from "@/lib/types/collection";
import { formatDate } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, LoadingState } from "@/components/shared";
import { PilotClient } from "@/components/pilot/pilot-client";
import { ReportView, STATUS_STYLE, StatusPill } from "./status";

const OPEN: CollectionPeriod["status"][] = ["ATTENDU", "EN_RETARD", "REJETE"];

/**
 * Espace client « Collecte » (avenant §10). En démonstration, un sélecteur change de rôle pour montrer
 * les trois vues ; en production le rôle vient de la session et le serveur filtre par `entityScope`.
 */
export function ClientCollection() {
  const [demoRole, setRole] = useState<CollectionViewerRole>("CLIENT_CONTRIBUTEUR");
  const [version, setVersion] = useState(0);
  const data = useAsync(() => getClientCollection(demoRole), [demoRole, version]);
  // `db`: the role is the session's; the picker below only exists in the demo.
  const sessionRole = data.status === "success" ? data.data.viewerRole : undefined;
  const role: CollectionViewerRole = USE_DB && sessionRole && sessionRole !== "ADMIN" ? sessionRole : demoRole;

  // The check runs in the worker: while a deposit is being checked, look again every few seconds.
  const checking = data.status === "success" && data.data.rows.some((r) => r.periods.some((p) => p.status === "EN_CONTROLE"));
  useEffect(() => {
    if (!USE_DB || !checking) return;
    const timer = setTimeout(() => setVersion((v) => v + 1), 4000);
    return () => clearTimeout(timer);
  }, [checking, version]);

  return (
    <div className="space-y-5">
      {!USE_DB && <fieldset className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-border p-3">
        <legend className="px-1 text-xs font-medium text-muted-foreground">Démonstration : voir l&apos;espace en tant que…</legend>
        {(Object.keys(VIEWER_ROLE_LABELS) as CollectionViewerRole[]).map((r) => (
          <label key={r} className={cn("cursor-pointer rounded-full border px-3 py-1 text-sm focus-within:ring-2 focus-within:ring-accent", role === r ? "border-accent bg-accent text-accent-foreground" : "border-border hover:bg-muted")}>
            <input type="radio" name="viewer-role" className="sr-only" checked={role === r} onChange={() => setRole(r)} />
            {VIEWER_ROLE_LABELS[r]}
          </label>
        ))}
        <span className="text-xs text-muted-foreground">
          {role === "CLIENT_CONTRIBUTEUR" && "Ne voit que les entités qui lui sont affectées."}
          {role === "CLIENT_DIRECTION" && "Voit toutes les entités de son entreprise et peut déposer."}
          {role === "CLIENT_ANALYSTE" && "Lecture seule : statuts et exports, aucun dépôt."}
        </span>
      </fieldset>}

      {data.status === "loading" && <LoadingState />}
      {data.status === "error" && <ErrorState message="Collecte indisponible." onRetry={data.reload} />}
      {data.status === "success" && (
        <>
          {role !== "CLIENT_ANALYSTE" && <Deposits rows={data.data.rows} role={role} onChanged={() => setVersion((v) => v + 1)} />}
          {role !== "CLIENT_CONTRIBUTEUR" && <ReadOnlyMatrix rows={data.data.rows} months={data.data.months} analyst={role === "CLIENT_ANALYSTE"} />}
          {/* Pilot results are demo data until the database wiring (steps B8 to B10). */}
          {role !== "CLIENT_CONTRIBUTEUR" && !USE_DB && data.data.rows.some((r) => r.entity.sector === "HOTELLERIE") && <PilotClient />}
        </>
      )}
    </div>
  );
}

function Deposits({ rows, role, onChanged }: { rows: TrackingRow[]; role: CollectionViewerRole; onChanged: () => void }) {
  const open = rows
    .flatMap((r) => r.periods.filter((p) => OPEN.includes(p.status)).map((p) => ({ row: r, period: p })))
    .sort((a, b) => a.period.dueAt.localeCompare(b.period.dueAt));
  const waiting = rows.flatMap((r) => r.periods.filter((p) => p.status === "EN_CONTROLE").map((p) => ({ row: r, period: p })));

  return (
    <section aria-label="Mes dépôts" className="space-y-3">
      <h2 className="text-lg font-bold text-primary">Mes dépôts</h2>
      {open.length === 0 && waiting.length === 0 && <EmptyState message="Rien à déposer pour le moment. Merci !" />}
      {open.map(({ row, period }) => (
        <DepositCard key={period.id} row={row} period={period} role={role} onChanged={onChanged} />
      ))}
      {waiting.map(({ row, period }) => (
        <div key={period.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-background p-4">
          <p className="font-semibold capitalize text-primary">{row.entity.name} — {periodLabel(period)}</p>
          <StatusPill status="EN_CONTROLE" />
        </div>
      ))}
    </section>
  );
}

function DepositCard({ row, period, role, onChanged }: { row: TrackingRow; period: CollectionPeriod; role: CollectionViewerRole; onChanged: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const due = dueLabel(period.dueAt);
  const last = period.submissions.at(-1);

  const send = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const s = await submitDeposit(period.id, USE_DB ? file : { name: file.name, size: file.size }, role);
      if (s.status === "EN_CONTROLE") toast.success("Fichier reçu : contrôle en cours, le résultat s'affiche dans quelques secondes.");
      else if (s.status === "VALIDE") toast.success("Dépôt validé. Merci !");
      else toast.error("Dépôt rejeté : consultez le rapport de contrôle ci-dessous.");
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Dépôt impossible, réessayez.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <article className={cn("space-y-3 rounded-xl border bg-background p-4", due.late ? "border-danger/40" : "border-border")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold capitalize text-primary">{row.entity.name} — {periodLabel(period)}</h3>
          <p className="text-sm text-muted-foreground">{row.template.label}</p>
        </div>
        <div className="text-right">
          <StatusPill status={period.status} />
          <p className={cn("mt-1 flex items-center justify-end gap-1 text-xs", due.late ? "font-semibold text-danger" : "text-muted-foreground")}>
            <CalendarClock className="h-3.5 w-3.5" aria-hidden /> Échéance {formatDate(period.dueAt)} · {due.text}
          </p>
        </div>
      </div>

      {period.status === "REJETE" && last && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-danger">Votre dépôt (version {last.version}) a été rejeté. Corrigez les lignes suivantes puis déposez une nouvelle version.</p>
          <ReportView report={last.report} />
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => (USE_DB ? window.location.assign(templateUrl(period.id)) : toast.info("Modèle Excel pré-rempli disponible avec la base de données (DATA_SOURCE=db)"))}>
          <Download className="h-4 w-4" aria-hidden /> Télécharger le modèle
        </Button>
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); void send(e.dataTransfer.files[0]); }}
        className={cn("flex flex-col items-center gap-2 rounded-lg border-2 border-dashed p-5 text-center text-sm transition-colors", drag ? "border-accent bg-accent/10" : "border-border")}
      >
        <UploadCloud className="h-6 w-6 text-muted-foreground" aria-hidden />
        <p>Glissez votre fichier Excel ici, ou</p>
        <Button type="button" variant="accent" size="sm" loading={busy} onClick={() => input.current?.click()}>
          {period.status === "REJETE" ? "Déposer une nouvelle version" : "Choisir un fichier"}
        </Button>
        <input ref={input} type="file" accept=".xlsx" className="sr-only" aria-label={`Fichier pour ${row.entity.name}, ${periodLabel(period)}`} onChange={(e) => void send(e.target.files?.[0])} />
        <p className="text-xs text-muted-foreground">.xlsx uniquement (pas de .xls ni .xlsm), 10 Mo maximum.</p>
      </div>

      {period.submissions.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">Historique de vos dépôts ({period.submissions.length})</summary>
          <ul className="mt-2 space-y-1">
            {[...period.submissions].reverse().map((s) => (
              <li key={s.id} className="flex items-center gap-2"><FileSpreadsheet className="h-4 w-4 text-muted-foreground" aria-hidden /> Version {s.version} · {s.originalName} · {formatDate(s.uploadedAt)}</li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}

function ReadOnlyMatrix({ rows, months, analyst }: { rows: TrackingRow[]; months: { key: string; label: string }[]; analyst: boolean }) {
  return (
    <section aria-label="Suivi des entités" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold text-primary">Suivi de vos entités</h2>
        <div className="flex flex-wrap gap-2">
          {[...new Map(rows.map((r) => [r.template.id, r.template])).values()].map((template) => (
            <Button
              key={template.id}
              variant="outline"
              size="sm"
              onClick={() => (USE_DB && months.length ? window.location.assign(exportUrl({ templateId: template.id, from: months[0]!.key, to: months.at(-1)!.key })) : toast.info("Export disponible avec la base de données (DATA_SOURCE=db)"))}
            >
              <Download className="h-4 w-4" aria-hidden /> {analyst ? "Export consolidé" : "Dépôts validés"} — {template.label}
            </Button>
          ))}
        </div>
      </div>
      <div className="relative overflow-x-auto rounded-xl border border-border bg-background">
        <table className="w-full min-w-[640px] text-sm">
          <caption className="sr-only">Statut des dépôts par entité et par mois</caption>
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2">Entité</th>
              {months.map((m) => <th key={m.key} scope="col" className="px-2 py-2 text-center capitalize">{m.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.plan.id} className="border-t border-border">
                <th scope="row" className="px-3 py-2 text-left font-normal"><p className="font-semibold text-primary">{r.entity.name}</p><p className="text-xs text-muted-foreground">{r.template.label}</p></th>
                {months.map((m) => {
                  const status = r.periods.find((p) => monthKey(p) === m.key)?.status ?? "A_VENIR";
                  return (
                    <td key={m.key} className="px-1.5 py-1.5 text-center">
                      <span className={cn("inline-flex h-8 min-w-9 items-center justify-center rounded-md px-1.5 text-xs font-bold", STATUS_STYLE[status].cell)}>
                        <span aria-hidden>{STATUS_STYLE[status].symbol}</span>
                        <span className="sr-only">{`${r.entity.name}, ${m.label} : ${status}`}</span>
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
