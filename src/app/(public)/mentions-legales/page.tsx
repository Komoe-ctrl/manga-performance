import type { Metadata } from "next";
import { PageHeader } from "@/components/shared";

export const metadata: Metadata = { title: "Mentions légales" };

export default function Page() {
  return (
    <div className="mx-auto max-w-6xl p-4">
      <PageHeader title="Mentions légales" description="Écran détaillé prévu à l'étape 2." />
    </div>
  );
}
