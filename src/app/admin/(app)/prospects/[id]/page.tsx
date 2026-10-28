import type { Metadata } from "next";
import { PageHeader } from "@/components/shared";

export const metadata: Metadata = { title: "Fiche prospect" };

export default function Page() {
  return (
    <div className="mx-auto max-w-6xl p-4">
      <PageHeader title="Fiche prospect" description="Écran détaillé prévu à l'étape 4." />
    </div>
  );
}
