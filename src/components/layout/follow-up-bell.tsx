"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell } from "lucide-react";
import { endOfDay, parseISO } from "date-fns";
import { useAsync } from "@/lib/hooks/use-async";
import { listFollowUps } from "@/lib/services";
import { REFERENCE_DATE } from "@/lib/constants";

/** Cloche : relances du jour (et en retard). */
export function FollowUpBell() {
  const pathname = usePathname();
  const followUps = useAsync(listFollowUps, [pathname]);
  const today = parseISO(REFERENCE_DATE);
  const due =
    followUps.status === "success"
      ? followUps.data.filter((f) => !f.done && parseISO(f.dueAt) <= endOfDay(today)).length
      : 0;

  return (
    <Link href="/admin/relances" aria-label={`Relances du jour : ${due}`} className="relative ml-auto rounded-md p-2 hover:bg-muted">
      <Bell className="h-5 w-5" aria-hidden />
      {due > 0 && (
        <span className="absolute -right-0.5 -top-0.5 min-w-5 rounded-full bg-accent px-1 text-center text-xs font-semibold text-accent-foreground">
          {due}
        </span>
      )}
    </Link>
  );
}
