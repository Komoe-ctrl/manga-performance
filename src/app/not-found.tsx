import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main id="contenu" className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-3xl font-bold text-primary">Page introuvable</h1>
      <p className="text-muted-foreground">La page demandée n&apos;existe pas ou a été déplacée.</p>
      <Link href="/" className={buttonVariants({ variant: "accent" })}>Retour à l&apos;accueil</Link>
    </main>
  );
}
