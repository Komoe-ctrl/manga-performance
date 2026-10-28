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
      className="fixed bottom-4 right-4 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-accent text-accent-foreground shadow-lg"
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
