/** PRNG déterministe : mêmes fixtures à chaque rendu (évite les écarts SSR/client). */
export function createRng(seed: number) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => Math.floor(next() * (max - min + 1)) + min,
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)],
  };
}

/** Date de référence de la maquette. */
export const TODAY = new Date("2026-10-28T09:00:00.000Z");

export function daysFromToday(offset: number): string {
  const d = new Date(TODAY);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString();
}

export function phoneCI(rng: ReturnType<typeof createRng>): string {
  const pairs = Array.from({ length: 4 }, () => String(rng.int(0, 99)).padStart(2, "0"));
  return `+225 0${rng.pick([1, 5, 7])} ${pairs.join(" ")}`;
}
