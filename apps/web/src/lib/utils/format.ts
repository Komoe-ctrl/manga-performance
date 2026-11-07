import { format, parseISO } from "date-fns";
import { fr } from "date-fns/locale";

const fcfa = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

/** 1250000 → « 1 250 000 FCFA » (espaces insécables remplacés par des espaces simples). */
export function formatFCFA(amount: number): string {
  return `${fcfa.format(Math.round(amount)).replace(/[  ]/g, " ")} FCFA`;
}

/** ISO → « 28 oct. 2026 » */
export function formatDate(value: string | Date): string {
  const date = typeof value === "string" ? parseISO(value) : value;
  return format(date, "d MMM yyyy", { locale: fr });
}

/** Normalise un numéro ivoirien en « +225 07 XX XX XX XX ». */
export function formatPhoneCI(raw: string): string {
  const digits = raw.replace(/\D/g, "").replace(/^225/, "");
  if (digits.length !== 10) return raw;
  return `+225 ${digits.match(/.{2}/g)!.join(" ")}`;
}
