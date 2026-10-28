import type { Metadata } from "next";
import { PageHeader } from "@/components/shared";

export const metadata: Metadata = { title: "Éditer l'article" };

export default function Page() {
  return (
    <div className="mx-auto max-w-6xl p-4">
      <PageHeader title="Éditer l'article" description="Écran détaillé prévu à l'étape 7." />
    </div>
  );
}
