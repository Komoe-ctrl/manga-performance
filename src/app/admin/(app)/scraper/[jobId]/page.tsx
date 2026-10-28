import type { Metadata } from "next";
import { PageHeader } from "@/components/shared";

export const metadata: Metadata = { title: "Résultats du job" };

export default function Page() {
  return (
    <div className="mx-auto max-w-6xl p-4">
      <PageHeader title="Résultats du job" description="Écran détaillé prévu à l'étape 8." />
    </div>
  );
}
