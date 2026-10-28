import { cn } from "@/lib/utils/cn";
import { formatDate, formatFCFA } from "@/lib/utils/format";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold text-primary">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

export function KpiCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold text-primary">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

const TONES = {
  neutral: "bg-slate-100 text-slate-700",
  success: "bg-green-100 text-green-800",
  warning: "bg-orange-100 text-orange-800",
  danger: "bg-red-100 text-red-800",
  accent: "bg-accent text-accent-foreground",
} as const;

const STATUS_MAP: Record<string, { label: string; tone: keyof typeof TONES }> = {
  nouveau: { label: "Nouveau", tone: "neutral" },
  en_negociation: { label: "En négociation", tone: "warning" },
  client: { label: "Client", tone: "success" },
  perdu: { label: "Perdu", tone: "danger" },
  brouillon: { label: "Brouillon", tone: "neutral" },
  emise: { label: "Émise", tone: "accent" },
  payee: { label: "Payée", tone: "success" },
  en_attente: { label: "En attente", tone: "warning" },
  en_retard: { label: "En retard", tone: "danger" },
  annulee: { label: "Annulée", tone: "neutral" },
  publie: { label: "Publié", tone: "success" },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS_MAP[status] ?? { label: status, tone: "neutral" as const };
  return (
    <span className={cn("inline-block rounded-full px-2.5 py-0.5 text-xs font-medium", TONES[s.tone])}>
      {s.label}
    </span>
  );
}

export const MoneyAmount = ({ value }: { value: number }) => (
  <span className="whitespace-nowrap">{formatFCFA(value)}</span>
);

export const DateLabel = ({ value }: { value: string }) => (
  <time dateTime={value}>{formatDate(value)}</time>
);

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}

export function LoadingState() {
  return (
    <div role="status" aria-label="Chargement" className="animate-pulse space-y-2">
      <div className="h-4 w-1/3 rounded bg-muted" />
      <div className="h-4 w-full rounded bg-muted" />
      <div className="h-4 w-2/3 rounded bg-muted" />
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      {message}{" "}
      {onRetry && (
        <button onClick={onRetry} className="font-medium underline">
          Réessayer
        </button>
      )}
    </div>
  );
}
