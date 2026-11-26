"use client";

import { useAsync } from "@/lib/hooks/use-async";
import { getPublicProfile } from "@/lib/services";
import { EXPERTISE_FIGURE, KEY_FIGURE_LABELS } from "@/lib/content/site";
import { Section } from "./section";
import { CountUp } from "./motion-client";

/**
 * Chiffres clés de l'accueil, édités dans l'admin (Paramètres → Profil du cabinet). Un chiffre laissé vide est masqué ;
 * rien ne s'affiche avant que les valeurs configurées soient connues, pour que le compteur finisse toujours sur elles.
 */
export function KeyFigures() {
  const profile = useAsync(getPublicProfile);
  if (profile.status !== "success") return null;
  const k = profile.data.keyFigures;
  const figures = [
    k.experience ? { value: k.experience, label: KEY_FIGURE_LABELS.experience } : null,
    k.missions ? { value: k.missions, label: KEY_FIGURE_LABELS.missions } : null,
    k.sectors ? { value: k.sectors, label: KEY_FIGURE_LABELS.sectors } : null,
    EXPERTISE_FIGURE,
  ].filter((f): f is { value: string; label: string } => f !== null);

  return (
    <Section tone="muted">
      <dl className="reveal grid grid-cols-2 gap-6 text-center md:grid-cols-4">
        {figures.map((f) => (
          <div key={f.label}>
            <dd className="text-4xl font-extrabold text-primary md:text-5xl"><CountUp value={f.value} /></dd>
            <dt className="mt-1 text-sm text-muted-foreground">{f.label}</dt>
          </div>
        ))}
      </dl>
    </Section>
  );
}
