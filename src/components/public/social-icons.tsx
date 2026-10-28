import { socialLinks } from "@/lib/content/site";

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** Lucide n'a plus d'icônes de marques : tracés simples dessinés ici. */
const ICONS: Record<(typeof socialLinks)[number]["label"], React.ReactNode> = {
  LinkedIn: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="3" {...stroke} />
      <path d="M8 11v5M8 8v.01M12 16v-5M12 13a2.5 2.5 0 0 1 5 0v3" {...stroke} />
    </>
  ),
  Facebook: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="3" {...stroke} />
      <path d="M15.5 8H14a2 2 0 0 0-2 2v10M9.5 13H15" {...stroke} />
    </>
  ),
  Instagram: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="5" {...stroke} />
      <circle cx="12" cy="12" r="4" {...stroke} />
      <path d="M17.5 6.5v.01" {...stroke} />
    </>
  ),
};

export function SocialLinks() {
  return (
    <ul className="mt-2 flex gap-3">
      {socialLinks.map((s) => (
        <li key={s.label}>
          <a
            href={s.href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${s.label} (s'ouvre dans un nouvel onglet)`}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-accent hover:text-accent-foreground"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">{ICONS[s.label]}</svg>
          </a>
        </li>
      ))}
    </ul>
  );
}
