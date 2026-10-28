import type { Metadata } from "next";
import { PageHeader } from "@/components/shared";

export const metadata: Metadata = { title: "Service" };

const SLUGS = ["business-plan-bancable", "tableaux-de-bord-kpi", "tresorerie", "maitrise-des-couts"];

export function generateStaticParams() {
  return SLUGS.map((slug) => ({ slug }));
}

export default function Page() {
  return (
    <div className="mx-auto max-w-6xl p-4">
      <PageHeader title="Service" description="Page service détaillée prévue à l'étape 2." />
    </div>
  );
}
