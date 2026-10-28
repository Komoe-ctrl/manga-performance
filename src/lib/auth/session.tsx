"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Session } from "@/lib/types";

interface SessionContextValue {
  session: Session;
  /** false tant que la session n'a pas été relue depuis sessionStorage. */
  ready: boolean;
  signIn: (session: NonNullable<Session>) => void;
  signOut: () => void;
}

const KEY = "mp-session";
const SessionContext = createContext<SessionContextValue | null>(null);

/** Authentification simulée : sessionStorage uniquement, aucune vraie auth. */
export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
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
    sessionStorage.setItem(KEY, JSON.stringify(s));
  }, []);
  const signOut = useCallback(() => {
    setSession(null);
    sessionStorage.removeItem(KEY);
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
