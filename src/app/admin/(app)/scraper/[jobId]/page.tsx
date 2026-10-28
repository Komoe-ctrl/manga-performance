import { Suspense } from "react";
import { LoadingState } from "@/components/shared";
import { JobResults } from "@/components/scraper/job-results";

export default function Page({ params }: { params: Promise<{ jobId: string }> }) {
  return (
    <Suspense fallback={<LoadingState />}>
      <JobResults params={params} />
    </Suspense>
  );
}
