"use client";

import { use, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAsync } from "@/lib/hooks/use-async";
import { createSequence, getSequence, listProspects, listSequences, updateSequence } from "@/lib/services";
import { NEED_LABELS } from "@/lib/constants";
import type { EmailSequence, Prospect } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { EmptyState, ErrorState, LoadingState } from "@/components/shared";

const TRIGGERS: Record<EmailSequence["trigger"], string> = {
  inscription_newsletter: "Inscription à la newsletter",
  manuel: "Manuel",
};
const VARIABLES = ["{{prenom}}", "{{entreprise}}", "{{secteur}}", "{{besoin}}"] as const;
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)} %` : "—");

export function SequencesList() {
  const router = useRouter();
  const seqs = useAsync(listSequences);
  const [name, setName] = useState("");

  if (seqs.status === "loading") return <LoadingState />;
  if (seqs.status === "error") return <ErrorState message="Séquences indisponibles." onRetry={seqs.reload} />;

  return (
    <div className="space-y-4">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (name.trim().length < 3) return toast.error("Donnez un nom à la séquence");
          const seq = await createSequence(name.trim());
          router.push(`/admin/sequences/${seq.id}`);
        }}
      >
        <div className="min-w-60 flex-1">
          <Field label="Nouvelle séquence" htmlFor="seq-name">
            <Input id="seq-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nom de la séquence" />
          </Field>
        </div>
        <Button type="submit"><Plus className="h-4 w-4" aria-hidden /> Créer</Button>
      </form>

      {seqs.data.length === 0 ? (
        <EmptyState message="Aucune séquence." />
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2">
          {seqs.data.map((s) => (
            <li key={s.id} className="rounded-lg border border-border p-4">
              <div className="flex items-start justify-between gap-2">
                <Link href={`/admin/sequences/${s.id}`} className="font-semibold text-primary hover:underline">{s.name}</Link>
                <span className={s.active ? "text-xs font-medium text-success" : "text-xs text-muted-foreground"}>
                  {s.active ? "Active" : "Inactive"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">Déclencheur : {TRIGGERS[s.trigger]} · {s.steps.length} étape(s)</p>
              <dl className="mt-3 grid grid-cols-5 gap-2 text-center text-xs">
                {[
                  ["Inscrits", String(s.stats.enrolled)],
                  ["Envoyés", String(s.stats.sent)],
                  ["Ouverture*", pct(s.stats.opened, s.stats.sent)],
                  ["Clic", pct(s.stats.clicked, s.stats.sent)],
                  ["Désinsc.", String(s.stats.unsubscribed)],
                ].map(([k, v]) => (
                  <div key={k}><dd className="text-base font-bold text-primary">{v}</dd><dt className="text-muted-foreground">{k}</dt></div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">* Le taux d&apos;ouverture est indicatif.</p>
    </div>
  );
}

function fill(text: string, p: Prospect | undefined) {
  if (!p) return text;
  return text
    .replaceAll("{{prenom}}", p.contactName.split(" ")[0])
    .replaceAll("{{entreprise}}", p.companyName)
    .replaceAll("{{secteur}}", p.sector)
    .replaceAll("{{besoin}}", NEED_LABELS[p.need]);
}

function SequenceForm({ initial, samples }: { initial: EmailSequence; samples: Prospect[] }) {
  const [seq, setSeq] = useState(initial);
  const [sampleId, setSampleId] = useState(samples[0]?.id ?? "");
  const [saving, setSaving] = useState(false);
  const focused = useRef<{ index: number; el: HTMLTextAreaElement } | null>(null);
  const sample = samples.find((p) => p.id === sampleId);

  const setStep = (i: number, patch: Partial<EmailSequence["steps"][number]>) =>
    setSeq((s) => ({ ...s, steps: s.steps.map((st, k) => (k === i ? { ...st, ...patch } : st)) }));

  const insertVariable = (v: string) => {
    const f = focused.current;
    if (!f) return toast.info("Cliquez d'abord dans le corps d'un email");
    const { el, index } = f;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    setStep(index, { body: el.value.slice(0, start) + v + el.value.slice(end) });
  };

  const save = async () => {
    if (seq.name.trim().length < 3) return toast.error("Le nom est requis");
    if (seq.steps.some((s) => !s.subject.trim() || !s.body.trim())) return toast.error("Chaque étape doit avoir un objet et un corps");
    setSaving(true);
    await updateSequence(seq.id, {
      name: seq.name.trim(),
      trigger: seq.trigger,
      active: seq.active,
      steps: seq.steps.map((s, i) => ({ ...s, order: i + 1 })),
    });
    setSaving(false);
    toast.success("Séquence enregistrée");
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nom *" htmlFor="seq-title">
            <Input id="seq-title" value={seq.name} onChange={(e) => setSeq({ ...seq, name: e.target.value })} />
          </Field>
          <Field label="Déclencheur" htmlFor="seq-trigger">
            <Select id="seq-trigger" value={seq.trigger} onChange={(e) => setSeq({ ...seq, trigger: e.target.value as EmailSequence["trigger"] })}>
              {Object.entries(TRIGGERS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={seq.active} onChange={(e) => setSeq({ ...seq, active: e.target.checked })} />
          Séquence active
        </label>

        <div role="group" aria-label="Variables de personnalisation" className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">Insérer :</span>
          {VARIABLES.map((v) => (
            <button key={v} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => insertVariable(v)} className="rounded border border-border px-2 py-1 font-mono text-xs hover:bg-muted">
              {v}
            </button>
          ))}
        </div>

        <ol className="space-y-4">
          {seq.steps.map((st, i) => (
            <li key={i} className="space-y-3 rounded-lg border border-border p-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-primary">Étape {i + 1}</h3>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Supprimer l'étape ${i + 1}`}
                  disabled={seq.steps.length === 1}
                  onClick={() => setSeq((s) => ({ ...s, steps: s.steps.filter((_, k) => k !== i) }))}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
                <Field label="Délai (jours)" htmlFor={`delay-${i}`}>
                  <Input id={`delay-${i}`} type="number" min={0} value={st.delayDays} onChange={(e) => setStep(i, { delayDays: Math.max(0, Number(e.target.value) || 0) })} />
                </Field>
                <Field label="Objet" htmlFor={`subject-${i}`}>
                  <Input id={`subject-${i}`} value={st.subject} onChange={(e) => setStep(i, { subject: e.target.value })} />
                </Field>
              </div>
              <Field label="Corps" htmlFor={`body-${i}`}>
                <Textarea
                  id={`body-${i}`}
                  value={st.body}
                  onFocus={(e) => (focused.current = { index: i, el: e.currentTarget })}
                  onChange={(e) => setStep(i, { body: e.target.value })}
                />
              </Field>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => setSeq((s) => ({ ...s, steps: [...s.steps, { order: s.steps.length + 1, delayDays: 3, subject: "", body: "" }] }))}>
            <Plus className="h-4 w-4" aria-hidden /> Ajouter une étape
          </Button>
          <Button type="button" variant="accent" disabled={saving} onClick={save}>Enregistrer</Button>
        </div>
      </div>

      <aside className="space-y-3">
        <h2 className="font-semibold text-primary">Aperçu</h2>
        <Field label="Prospect exemple" htmlFor="sample">
          <Select id="sample" value={sampleId} onChange={(e) => setSampleId(e.target.value)}>
            {samples.map((p) => <option key={p.id} value={p.id}>{p.companyName}</option>)}
          </Select>
        </Field>
        {seq.steps.map((st, i) => (
          <article key={i} className="rounded-lg border border-border bg-muted p-3 text-sm">
            <p className="text-xs text-muted-foreground">J+{seq.steps.slice(0, i + 1).reduce((s, x) => s + x.delayDays, 0)}</p>
            <p className="font-semibold">{fill(st.subject, sample) || "(sans objet)"}</p>
            <p className="mt-1 whitespace-pre-wrap">{fill(st.body, sample) || "(corps vide)"}</p>
          </article>
        ))}
      </aside>
    </div>
  );
}

export function SequenceEditor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const data = useAsync(async () => ({ seq: await getSequence(id), prospects: await listProspects() }));
  if (data.status === "loading") return <LoadingState />;
  if (data.status === "error") return <ErrorState message="Séquence indisponible." onRetry={data.reload} />;
  if (!data.data.seq) return <EmptyState message="Séquence introuvable." />;
  return <SequenceForm key={data.data.seq.id} initial={structuredClone(data.data.seq)} samples={data.data.prospects.slice(0, 5)} />;
}
