import { ratio } from "./sector";

/**
 * KPI hôteliers (avenant n°1, §11.2 et §11 bis). Fonctions pures ; division par zéro → `null`.
 * Les montants sont en FCFA entiers ; les pourcentages sont des nombres (31,7 = 31,7 %).
 */

export interface HotelInput {
  nombreChambres: number;
  chambresVendues: number;
  caChambres: number;
  revenusTotaux: number;
  chargesDepartementales: number;
  chargesNonReparties: number;
  commissionsOta?: number | null;
  /** Nombre de jours de la période (déduit de la période du dépôt). */
  jours: number;
}

export interface HotelKpis {
  chambresDisponibles: number;
  gop: number;
  revpar: number | null;
  trevpar: number | null;
  goppar: number | null;
  gopMarginPct: number | null;
  tauxOccupationPct: number | null;
  adr: number | null;
  /** TODO(client): « Proposition » — poids des commissions OTA dans le CA chambres. */
  poidsOtaPct: number | null;
}

export function hotelKpis(i: HotelInput): HotelKpis {
  const chambresDisponibles = i.nombreChambres * i.jours;
  const gop = i.revenusTotaux - i.chargesDepartementales - i.chargesNonReparties;
  return {
    chambresDisponibles,
    gop,
    revpar: ratio(i.caChambres, chambresDisponibles),
    trevpar: ratio(i.revenusTotaux, chambresDisponibles),
    goppar: ratio(gop, chambresDisponibles),
    // Multiply before dividing to avoid float noise (see `sector.ts`).
    gopMarginPct: ratio(gop * 100, i.revenusTotaux),
    tauxOccupationPct: ratio(i.chambresVendues * 100, chambresDisponibles),
    adr: ratio(i.caChambres, i.chambresVendues),
    poidsOtaPct: i.commissionsOta == null ? null : ratio(i.commissionsOta * 100, i.caChambres),
  };
}

/* ---------- Alertes (seuils du client, avenant §11 bis) ---------- */

export type HotelAlertCode = "GOP_MARGIN_LOW" | "GOP_MARGIN_WATCH" | "PROFIT_VS_REVPAR" | "COSTS_OUTPACE" | "ANNEXES_STRONG" | "INPUT_MISSING";
/** `alert` 🔴, `watch` 🟠, `info` ℹ️, `missing` ⚠️. */
export type HotelAlertLevel = "alert" | "watch" | "info" | "missing";

export interface HotelAlert {
  code: HotelAlertCode;
  level: HotelAlertLevel;
  message: string;
}

export interface HotelAlertOptions {
  /** KPI du mois précédent, pour détecter des coûts qui progressent plus vite que les revenus. */
  previous?: Pick<HotelKpis, "revpar" | "goppar"> | null;
  /** Données d'entrée manquantes (libellés), signalées par `INPUT_MISSING`. */
  missing?: readonly string[];
  /** TODO(client): TRevPAR ≥ 1,5 × RevPAR → annexes fortes. */
  annexesFactor?: number;
}

/** Aucune alerte n'est calculée sur une valeur `null`. Les alertes vont au consultant, jamais au client. */
export function hotelAlerts(k: HotelKpis, options: HotelAlertOptions = {}): HotelAlert[] {
  const alerts: HotelAlert[] = [];
  for (const name of options.missing ?? []) {
    alerts.push({ code: "INPUT_MISSING", level: "missing", message: `Donnée manquante : ${name}.` });
  }
  if (k.gopMarginPct !== null) {
    if (k.gopMarginPct < 30) alerts.push({ code: "GOP_MARGIN_LOW", level: "alert", message: "Marge GOP inférieure à 30 %." });
    else if (k.gopMarginPct < 35) alerts.push({ code: "GOP_MARGIN_WATCH", level: "watch", message: "Marge GOP entre 30 % et 35 % : à surveiller." });
  }
  const goppar = ratio(k.goppar, k.revpar);
  if (goppar !== null && goppar < 0.3) alerts.push({ code: "PROFIT_VS_REVPAR", level: "watch", message: "Profit faible par rapport au RevPAR." });

  const prev = options.previous;
  if (prev && k.revpar !== null && k.goppar !== null && prev.revpar !== null && prev.goppar !== null && k.revpar > prev.revpar && k.goppar < prev.goppar) {
    alerts.push({ code: "COSTS_OUTPACE", level: "watch", message: "Les coûts progressent plus vite que les revenus." });
  }
  const factor = options.annexesFactor ?? 1.5;
  if (k.trevpar !== null && k.revpar !== null && k.revpar > 0 && k.trevpar >= factor * k.revpar) {
    alerts.push({ code: "ANNEXES_STRONG", level: "info", message: "Bonne contribution des annexes." });
  }
  return alerts;
}
