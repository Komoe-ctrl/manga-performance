"use client";

import { useCallback, useEffect, useId, useRef } from "react";
import { USE_DB } from "@/lib/services/data-source";

interface TurnstileApi {
  render(
    element: HTMLElement,
    options: { sitekey: string; callback: (token: string) => void; "expired-callback"?: () => void; "error-callback"?: () => void },
  ): string;
  reset(widgetId?: string): void;
  remove(widgetId: string): void;
}
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
const SCRIPT_ID = "cf-turnstile-script";
const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

function whenTurnstileReady(callback: (api: TurnstileApi) => void): () => void {
  if (window.turnstile) {
    callback(window.turnstile);
    return () => {};
  }
  let script = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
  if (!script) {
    script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = SCRIPT_SRC;
    script.async = true;
    document.head.appendChild(script);
  }
  const onLoad = () => window.turnstile && callback(window.turnstile);
  script.addEventListener("load", onLoad);
  return () => script?.removeEventListener("load", onLoad);
}

export interface LeadGuard {
  /** Anti-spam fields to send with the lead. */
  read(): { turnstileToken: string; website: string };
  /** Turnstile tokens are single-use: call after each submission attempt. */
  reset(): void;
  /** @internal wiring used by `<LeadGuardFields />`. */
  honeypotId: string;
  setToken: (token: string) => void;
  setWidget: (id: string | undefined) => void;
  removeWidget: () => void;
}

/** Anti-spam state for a public form (spec, section 5): Turnstile token + honeypot. */
export function useLeadGuard(): LeadGuard {
  const tokenRef = useRef("");
  const honeypotId = useId();
  const widgetRef = useRef<string | undefined>(undefined);

  const read = useCallback(
    () => {
      // Read from the DOM at submit time: bots set the value without going through React.
      const honeypot = document.getElementById(honeypotId) as HTMLInputElement | null;
      return { turnstileToken: tokenRef.current, website: honeypot?.value ?? "" };
    },
    [honeypotId],
  );
  const reset = useCallback(() => {
    tokenRef.current = "";
    if (widgetRef.current) window.turnstile?.reset(widgetRef.current);
  }, []);

  const setToken = useCallback((token: string) => {
    tokenRef.current = token;
  }, []);
  const setWidget = useCallback((id: string | undefined) => {
    widgetRef.current = id;
  }, []);
  const removeWidget = useCallback(() => {
    if (widgetRef.current) window.turnstile?.remove(widgetRef.current);
    widgetRef.current = undefined;
  }, []);

  return { read, reset, honeypotId, setToken, setWidget, removeWidget };
}

/**
 * Renders the invisible honeypot and the Turnstile widget. With `DATA_SOURCE=mock`
 * there is no server to protect, so nothing is rendered.
 */
export function LeadGuardFields({ guard }: { guard: LeadGuard }) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!USE_DB || !SITE_KEY || !container.current) return;
    const element = container.current;
    let removed = false;
    const stop = whenTurnstileReady((api) => {
      if (removed) return;
      guard.setWidget(
        api.render(element, {
          sitekey: SITE_KEY,
          callback: (token) => guard.setToken(token),
          "expired-callback": () => guard.setToken(""),
          "error-callback": () => guard.setToken(""),
        }),
      );
    });
    return () => {
      removed = true;
      stop();
      guard.removeWidget();
    };
  }, [guard]);

  if (!USE_DB) return null;
  return (
    <>
      {/* Honeypot: invisible to people and to screen readers, irresistible to bots. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Ne pas remplir
          <input id={guard.honeypotId} type="text" name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>
      <div ref={container} className="min-h-[65px]" />
    </>
  );
}
