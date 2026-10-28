"use client";

import { useAsync } from "@/lib/hooks/use-async";
import { EmptyState, ErrorState, LoadingState } from "@/components/shared";

/** Écran provisoire de l'étape 1 : prouve que la couche services répond. */
export function MockOverview<T>({
  loader,
  label,
  render,
}: {
  loader: () => Promise<T[]>;
  label: string;
  render: (item: T) => string;
}) {
  const state = useAsync(loader);
  if (state.status === "loading") return <LoadingState />;
  if (state.status === "error") return <ErrorState message={state.error.message} onRetry={state.reload} />;
  if (state.data.length === 0) return <EmptyState message={`Aucun élément (${label}).`} />;
  return (
    <div>
      <p className="mb-2 text-sm text-muted-foreground">
        {state.data.length} {label} chargés depuis les fixtures. Écran détaillé : étape suivante.
      </p>
      <ul className="max-h-80 divide-y divide-border overflow-auto rounded-lg border border-border text-sm">
        {state.data.slice(0, 10).map((item, i) => (
          <li key={i} className="px-3 py-2">{render(item)}</li>
        ))}
      </ul>
    </div>
  );
}
