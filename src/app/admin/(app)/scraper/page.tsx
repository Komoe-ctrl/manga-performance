import { PageHeader } from "@/components/shared";
import { ScraperHome } from "@/components/scraper/scraper-home";

export default function Page() {
  return (
    <>
      <PageHeader title="Scraper" description="Collecte de prospects depuis des sources publiques." />
      <ScraperHome />
    </>
  );
}
