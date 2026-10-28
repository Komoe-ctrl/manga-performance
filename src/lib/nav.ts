export interface NavItem {
  label: string;
  href: string;
  children?: NavItem[];
}

export const publicNav: NavItem[] = [
  { label: "Accueil", href: "/" },
  { label: "À propos", href: "/a-propos" },
  { label: "Services", href: "/services" },
  { label: "Références", href: "/references" },
  { label: "Blog", href: "/blog" },
  { label: "Démo", href: "/demo" },
  { label: "Contact", href: "/contact" },
];

export const adminNav: NavItem[] = [
  { label: "Tableau de bord", href: "/admin" },
  {
    label: "Commercial",
    href: "/admin/prospects",
    children: [
      { label: "Prospects", href: "/admin/prospects" },
      { label: "Relances", href: "/admin/relances" },
      { label: "Clients", href: "/admin/clients" },
    ],
  },
  { label: "Facturation", href: "/admin/factures" },
  {
    label: "Marketing",
    href: "/admin/sequences",
    children: [
      { label: "Séquences", href: "/admin/sequences" },
      { label: "Newsletter", href: "/admin/newsletter" },
      { label: "Blog", href: "/admin/blog" },
    ],
  },
  { label: "Scraper", href: "/admin/scraper" },
  { label: "Paramètres", href: "/admin/parametres" },
];

export const clientNav: NavItem[] = [
  { label: "Livrables", href: "/espace-client" },
  { label: "Messages", href: "/espace-client/messages" },
  { label: "Notifications", href: "/espace-client/notifications" },
];

export const WHATSAPP_NUMBER = "2250700000000"; // TODO: numéro réel à fournir par le client
