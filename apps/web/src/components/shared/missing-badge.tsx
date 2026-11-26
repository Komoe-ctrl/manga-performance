import { cn } from "@/lib/utils/cn";

/** Badge d'admin : ce contenu n'est pas fourni, donc le site public ne l'affiche pas. */
export function MissingBadge({ className }: { className?: string }) {
  return (
    <span className={cn("inline-block whitespace-nowrap rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-800", className)} title="Non affiché sur le site public tant qu'il n'est pas renseigné">
      Contenu manquant
    </span>
  );
}
