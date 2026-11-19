"use client";

import { useEffect, useRef, useState } from "react";
import { BellRing, Download, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import { useAsync } from "@/lib/hooks/use-async";
import { forcePeriod, getPeriodDetail, periodLabel, remindPeriods } from "@/lib/services/collection";
import { formatDate } from "@/lib/utils/format";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";
import { ErrorState, LoadingState } from "@/components/shared";
import { ReportView, StatusPill } from "./status";

/** Détail d'une période : versions, rapport de contrôle, relances, forçage (avenant §10). */
export function PeriodPanel({ periodId, onClose, onChanged }: { periodId: string | null; onClose: () => void; onChanged: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (periodId && !d.open) d.showModal();
    if (!periodId && d.open) d.close();
  }, [periodId]);

  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby="period-title" className="ml-auto mr-0 h-full max-h-full w-full max-w-xl overflow-y-auto p-0 backdrop:bg-black/50">
      {periodId && <PanelBody key={periodId} periodId={periodId} onClose={onClose} onChanged={onChanged} />}
    </dialog>
  );
}

function PanelBody({ periodId, onClose, onChanged }: { periodId: string; onClose: () => void; onChanged: () => void }) {
  const data = useAsync(() => getPeriodDetail(periodId), [periodId]);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await action();
      toast.success(success);
      onChanged();
      data.reload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Action impossible, réessayez.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border bg-background px-6 py-4">
        <h2 id="period-title" className="text-lg font-bold capitalize text-primary">
          {data.status === "success" ? `${data.data.row.entity.name} — ${periodLabel(data.data.period)}` : "Période"}
        </h2>
        <Button type="button" variant="ghost" size="icon" aria-label="Fermer" onClick={onClose}>
          <X className="h-5 w-5" aria-hidden />
        </Button>
      </div>
      <div className="space-y-6 px-6 py-5">
        {data.status === "loading" && <LoadingState />}
        {data.status === "error" && <ErrorState message="Détail indisponible." onRetry={data.reload} />}
        {data.status === "success" && (() => {
          const { period, row } = data.data;
          const last = period.submissions.at(-1);
          const canForce = last && (last.status === "REJETE" || last.status === "EN_CONTROLE");
          const canRemind = ["EN_RETARD", "ATTENDU", "REJETE"].includes(period.status);
          return (
            <>
              <section aria-label="Résumé" className="space-y-1 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill status={period.status} />
                  <span className="text-muted-foreground">{row.template.label} · {row.client.name}</span>
                </div>
                <p className="text-muted-foreground">Échéance : {formatDate(period.dueAt)} · {period.submissions.length} dépôt(s)</p>
              </section>

              <section aria-label="Dépôts" className="space-y-3">
                <h3 className="font-semibold text-primary">Dépôts</h3>
                {period.submissions.length === 0 && <p className="text-sm text-muted-foreground">Aucun dépôt pour cette période.</p>}
                {[...period.submissions].reverse().map((s) => (
                  <div key={s.id} className="space-y-2 rounded-lg border border-border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span className="font-semibold">Version {s.version} · {s.originalName}</span>
                      <span className="text-xs text-muted-foreground">{formatDate(s.uploadedAt)} · {s.uploadedBy}</span>
                    </div>
                    <p className="text-xs font-medium">{{ EN_CONTROLE: "En contrôle", REJETE: "Rejeté", VALIDE: "Validé", ACCEPTE_AVEC_RESERVE: "Accepté avec réserve" }[s.status]}</p>
                    <ReportView report={s.report} />
                    {s.reviewComment && <p className="rounded bg-muted p-2 text-xs"><strong>Réserve :</strong> {s.reviewComment}</p>}
                    <Button type="button" variant="outline" size="sm" onClick={() => toast.info("Téléchargement disponible avec la base de données (DATA_SOURCE=db)")}>
                      <Download className="h-4 w-4" aria-hidden /> Télécharger le fichier
                    </Button>
                  </div>
                ))}
              </section>

              {canForce && (
                <section aria-label="Forçage" className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
                  <h3 className="flex items-center gap-1.5 font-semibold text-primary"><ShieldCheck className="h-4 w-4" aria-hidden /> Accepter avec réserve</h3>
                  <Field label="Commentaire (obligatoire, journalisé)" htmlFor="force-comment">
                    <Textarea id="force-comment" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Pourquoi accepter malgré les erreurs ?" />
                  </Field>
                  <Button type="button" variant="accent" loading={busy} disabled={comment.trim().length < 5} onClick={() => run(() => forcePeriod(periodId, comment), "Période acceptée avec réserve")}>
                    Accepter avec réserve
                  </Button>
                </section>
              )}

              <section aria-label="Relances" className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-primary">Relances ({period.reminders.length})</h3>
                  <Button type="button" variant="outline" size="sm" disabled={!canRemind} loading={busy} onClick={() => run(async () => { if ((await remindPeriods([periodId])) === 0) throw new Error("Plafond de relances atteint pour cette période."); }, "Relance envoyée")}>
                    <BellRing className="h-4 w-4" aria-hidden /> Relancer maintenant
                  </Button>
                </div>
                {period.reminders.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Aucune relance envoyée.</p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {period.reminders.map((r, i) => (
                      <li key={i} className="flex justify-between gap-2 border-b border-border py-1">
                        <span><strong>{r.kind}</strong> · {r.recipients}</span>
                        <span className="text-muted-foreground">{formatDate(r.at)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          );
        })()}
      </div>
    </>
  );
}
