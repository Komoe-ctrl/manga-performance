"use client";

import { useRouter } from "next/navigation";
import { useSession } from "@/lib/auth/session";
import { useAsync } from "@/lib/hooks/use-async";
import { listClients } from "@/lib/services";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingState } from "@/components/shared";

/** Sélecteur de profil : authentification simulée. */
export function ProfilePicker({ space }: { space: "admin" | "client" }) {
  const { signIn } = useSession();
  const router = useRouter();
  const clients = useAsync(listClients);

  if (space === "admin") {
    return (
      <Button
        onClick={() => {
          signIn({ role: "consultant" });
          router.push("/admin");
        }}
      >
        Se connecter en tant que consultant
      </Button>
    );
  }

  if (clients.status === "loading") return <LoadingState />;
  if (clients.status === "error") return <ErrorState message={clients.error.message} onRetry={clients.reload} />;

  return (
    <ul className="space-y-2">
      {clients.data.slice(0, 6).map((c) => (
        <li key={c.id}>
          <Button
            variant="outline"
            className="w-full justify-start"
            onClick={() => {
              signIn({ role: "client", clientId: c.id });
              router.push("/espace-client");
            }}
          >
            Se connecter en tant que {c.companyName}
          </Button>
        </li>
      ))}
    </ul>
  );
}
