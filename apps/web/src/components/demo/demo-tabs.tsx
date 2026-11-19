"use client";

import { useState } from "react";
import type { SectorTabId } from "@/lib/demo/sector-views";
import { cn } from "@/lib/utils/cn";
import { DemoDashboard } from "./demo-dashboard";
import { SectorDemo } from "./sector-demo";

type TabId = "hotellerie" | SectorTabId;
const TABS: { id: TabId; label: string }[] = [
  { id: "hotellerie", label: "Hôtellerie" },
  { id: "restauration", label: "Restauration" },
  { id: "commerce", label: "Commerce" },
  { id: "btp", label: "BTP" },
  { id: "tech", label: "Tech / Fintech" },
];

/** Démo publique : 5 onglets sectoriels (avenant §11.1). */
export function DemoTabs() {
  const [tab, setTab] = useState<TabId>("hotellerie");
  return (
    <div className="space-y-6">
      <div role="tablist" aria-label="Secteur de la démonstration" className="flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls="demo-panel"
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
            onKeyDown={(e) => {
              const i = TABS.findIndex((x) => x.id === tab);
              const next = e.key === "ArrowRight" ? TABS[(i + 1) % TABS.length] : e.key === "ArrowLeft" ? TABS[(i - 1 + TABS.length) % TABS.length] : null;
              if (next) {
                setTab(next.id);
                document.getElementById(`tab-${next.id}`)?.focus();
              }
            }}
            className={cn("-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors", tab === t.id ? "border-accent text-primary" : "border-transparent text-muted-foreground hover:text-primary")}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="demo-panel" aria-labelledby={`tab-${tab}`}>
        {tab === "hotellerie" ? <DemoDashboard /> : <SectorDemo key={tab} id={tab} />}
      </div>
    </div>
  );
}
