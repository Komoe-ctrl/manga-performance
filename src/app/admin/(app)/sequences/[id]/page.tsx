import type { Metadata } from "next";
import { PageHeader } from "@/components/shared";

export const metadata: Metadata = { title: "Éditeur de séquence" };

export default function Page() {
  return (
    <div className="mx-auto max-w-6xl p-4">
      <PageHeader title="Éditeur de séquence" description="Écran détaillé prévu à l'étape 7." />
    </div>
  );
}
