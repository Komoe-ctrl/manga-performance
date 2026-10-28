"use client";

import { contactInfo, DEFAULT_WHATSAPP_MESSAGE } from "@/lib/content/site";
import { getSettings } from "@/lib/services";
import { useAsync } from "./use-async";

/** Lien wa.me construit depuis les Paramètres (valeurs par défaut tant qu'ils ne sont pas chargés). */
export function useWhatsAppUrl(message?: string) {
  const settings = useAsync(getSettings);
  const number = settings.status === "success" ? settings.data.whatsappNumber : contactInfo.whatsappNumber;
  const text = message ?? (settings.status === "success" ? settings.data.whatsappMessage : DEFAULT_WHATSAPP_MESSAGE);
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}
