"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Session } from "@/lib/types";
import { USE_DB } from "@/lib/services/data-source";
import { authClient, fetchCurrentUser } from "./auth-client";

interface SessionContextValue {
  session: Session;
  /** false tant que la session n'a pas été relue depuis sessionStorage. */
  ready: boolean;
  signIn: (session: NonNullable<Session>) => void;
  signOut: () => void;
}

const KEY = "mp-session";
const SessionContext = createContext<SessionContextValue | null>(null);

/**
 * Session de l'interface. `DATA_SOURCE=mock` : authentification simulée (sessionStorage).
 * `DATA_SOURCE=db` : la session vient de Better Auth ; seul le back-office est branché
 * (l'espace client l'est à l'étape 7), et chaque Server Action revérifie les droits.
 */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (USE_DB) {
      let cancelled = false;
      fetchCurrentUser()
        .catch(() => null)
        .then((user) => {
          if (cancelled) return;
          const isAdmin = user?.role === "ADMIN" && user.twoFactorEnabled;
          setSession(isAdmin ? { role: "consultant" } : null);
          setReady(true);
        });
      return () => {
        cancelled = true;
      };
    }
    try {
      const raw = sessionStorage.getItem(KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) setSession(JSON.parse(raw) as Session);
    } catch {
      /* stockage indisponible : session vide */
    }
    setReady(true);
  }, []);

  const signIn = useCallback((s: NonNullable<Session>) => {
    setSession(s);
    if (!USE_DB) sessionStorage.setItem(KEY, JSON.stringify(s));
  }, []);
  const signOut = useCallback(() => {
    setSession(null);
    if (USE_DB) void authClient.signOut();
    else sessionStorage.removeItem(KEY);
  }, []);

  const value = useMemo(
    () => ({ session, ready, signIn, signOut }),
    [session, ready, signIn, signOut],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession doit être utilisé dans SessionProvider");
  return ctx;
}
