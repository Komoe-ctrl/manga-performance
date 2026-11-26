import { usaliMapping, type UsaliFamily } from "@manga/db/usali";

const FAMILLE_LABEL: Record<UsaliFamily, string> = {
  DEPARTEMENTALE: "Départementale",
  NON_REPARTIE: "Non répartie",
  HORS_EXPLOITATION: "Hors exploitation",
};

/** Référentiel en lecture seule (avenant §11 ter) : les fiches d'hôtel n'ont pas à le modifier. */
export default function Page() {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Référentiel USALI</h2>
        <p className="text-sm text-muted-foreground">
          Classement des charges utilisé dans les modèles hôteliers et dans la feuille « Instructions ». Seules les
          familles départementale et non répartie entrent dans le GOP ; les charges hors exploitation en sont exclues.
        </p>
      </div>
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Poste de coût</th>
              <th className="px-4 py-3 font-medium">Famille</th>
              <th className="px-4 py-3 font-medium">Sous-catégorie USALI</th>
              <th className="px-4 py-3 font-medium">Impact</th>
              <th className="px-4 py-3 font-medium">Commentaire</th>
            </tr>
          </thead>
          <tbody>
            {usaliMapping.map((entry) => (
              <tr key={`${entry.famille}-${entry.sousCategorie}-${entry.poste}`} className="border-b border-border/60 last:border-0">
                <td className="px-4 py-3 font-medium">{entry.poste}</td>
                <td className="px-4 py-3">{FAMILLE_LABEL[entry.famille]}</td>
                <td className="px-4 py-3">{entry.sousCategorie}</td>
                <td className="px-4 py-3">{entry.impact}</td>
                <td className="px-4 py-3 text-muted-foreground">{entry.commentaire}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
