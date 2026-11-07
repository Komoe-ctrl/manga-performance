import Link from "next/link";
import { ArrowRight } from "lucide-react";

/** Lien secondaire « voir plus » (pastille + flèche). */
export function MoreLink({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <Link href={href} className={`more-link ${className ?? ""}`}>
      {children}
      <ArrowRight className="h-4 w-4" aria-hidden />
    </Link>
  );
}

/** Version non cliquable, pour une carte déjà entièrement cliquable (parent avec la classe `group`). */
export function MoreLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="more-link">
      {children}
      <ArrowRight className="h-4 w-4" aria-hidden />
    </span>
  );
}
