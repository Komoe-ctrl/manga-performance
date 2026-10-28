import type { Metadata } from "next";
import { PageHeader } from "@/components/shared";

export const metadata: Metadata = { title: "Nouvel article" };

export default function Page() {
  return (
    <div className="mx-auto max-w-6xl p-4">
      <PageHeader title="Nouvel article" description="Écran détaillé prévu à l'étape 7." />
    </div>
  );
}
