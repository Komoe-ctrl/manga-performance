"use client";

import { Button } from "@/components/ui/button";

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main id="contenu" className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-3xl font-bold text-primary">Une erreur est survenue</h1>
      <p className="text-muted-foreground">Veuillez réessayer. Si le problème persiste, contactez le cabinet.</p>
      <Button onClick={reset}>Réessayer</Button>
    </main>
  );
}
