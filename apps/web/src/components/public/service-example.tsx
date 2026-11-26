import Link from "next/link";
import { ArrowRight, FileSpreadsheet, FileText } from "lucide-react";

const iconOf = (deliverable: string) => (/excel|xlsx|tableau|modèle|plan de trésorerie/i.test(deliverable) ? FileSpreadsheet : FileText);

/**
 * Exemple concret de la mission : un lien vers l'onglet de la démo qui l'illustre, quand il existe ; sinon un aperçu des
 * livrables remis (les mêmes que ceux listés ci-dessus), pour qu'on voie à quoi ressemble le résultat.
 */
export function ServiceExample({ title, deliverables, demo }: { title: string; deliverables: string[]; demo?: { label: string; href: string } }) {
  return (
    <section aria-label={`Exemple : ${title}`} className="rounded-xl border border-border p-5">
      <h2 className="text-xl font-bold text-primary">Exemple</h2>
      {demo ? (
        <Link href={demo.href} className="card-lift group mt-3 flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 p-4 text-primary">
          <span>
            <span className="block font-semibold">{demo.label}</span>
            <span className="block text-sm text-muted-foreground">Données fictives, exemple de livrable MANGA PERFORMANCE.</span>
          </span>
          <ArrowRight className="h-5 w-5 shrink-0 transition-transform group-hover:translate-x-0.5" aria-hidden />
        </Link>
      ) : (
        <ul className="mt-3 grid gap-3 sm:grid-cols-2" aria-label="Aperçu des livrables remis">
          {deliverables.map((d) => {
            const Icon = iconOf(d);
            return (
              <li key={d} className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 p-3">
                <span className="flex h-12 w-10 shrink-0 items-center justify-center rounded border border-border bg-background text-primary shadow-sm" aria-hidden>
                  <Icon className="h-5 w-5" />
                </span>
                <span className="text-sm font-medium">{d}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
