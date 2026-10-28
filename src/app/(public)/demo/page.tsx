import type { Metadata } from "next";
import { PageHeader } from "@/components/shared";

export const metadata: Metadata = { title: "Dashboard de démonstration" };

export default function Page() {
  return (
    <div className="mx-auto max-w-6xl p-4">
      <PageHeader title="Dashboard de démonstration" description="Écran détaillé prévu à l'étape 3." />
    </div>
  );
}
