"use client";

import { MessageCircle } from "lucide-react";
import { useWhatsAppUrl } from "@/lib/hooks/use-whatsapp";
import { buttonVariants } from "@/components/ui/button";

export function WhatsAppFab() {
  const href = useWhatsAppUrl();
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Nous écrire sur WhatsApp"
      className="fixed bottom-3 right-3 z-50 flex h-11 w-11 items-center sm:bottom-4 sm:right-4 sm:h-12 sm:w-12 justify-center rounded-full bg-accent text-accent-foreground shadow-lg"
    >
      <MessageCircle aria-hidden />
    </a>
  );
}

export function WhatsAppButton({ message, className }: { message?: string; className?: string }) {
  const href = useWhatsAppUrl(message);
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: "accent", className })}>
      Écrire sur WhatsApp
    </a>
  );
}
