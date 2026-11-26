/** Durée de l'animation des chiffres clés. */
export const COUNT_UP_MS = 1400;

/** « 10+ » → { target: 10, suffix: "+" } ; un texte qui ne commence pas par un nombre (« MBA ») n'est pas animé. */
export function parseCountUp(value: string): { target: number; suffix: string } | null {
  const match = value.match(/^(\d+)(.*)$/);
  return match ? { target: Number(match[1]), suffix: match[2]! } : null;
}

/** Valeur affichée après `elapsedMs` : une courbe qui ralentit, et **toujours exactement la cible** à la fin. */
export function countUpAt(target: number, elapsedMs: number, duration = COUNT_UP_MS): number {
  const t = Math.min(1, Math.max(0, elapsedMs / duration));
  return t >= 1 ? target : Math.round(target * (1 - Math.pow(1 - t, 3)));
}
