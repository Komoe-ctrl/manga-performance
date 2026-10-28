import type { Metadata } from "next";
import { PageHeader } from "@/components/shared";

export const metadata: Metadata = { title: "Détail facture" };

export default function Page() {
  return (
    <div className="mx-auto max-w-6xl p-4">
      <PageHeader title="Détail facture" description="Écran détaillé prévu à l'étape 5." />
    </div>
  );
}
