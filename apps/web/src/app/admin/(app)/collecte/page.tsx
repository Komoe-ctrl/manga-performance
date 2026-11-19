import { PageHeader } from "@/components/shared";
import { TrackingBoard } from "@/components/collection/tracking-board";

export default function Page() {
  return (
    <>
      <PageHeader title="Collecte" description="Suivi des dépôts par entité et par période : qui a déposé, ce qui est en retard, ce qui a été rejeté." />
      <TrackingBoard />
    </>
  );
}
