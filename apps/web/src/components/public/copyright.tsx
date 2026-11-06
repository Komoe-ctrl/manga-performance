"use client";

import { useSyncExternalStore } from "react";

const noop = () => () => {};

/** Année courante du navigateur : se met à jour toute seule chaque année, sans toucher au code. */
export function CopyrightYear() {
  const year = useSyncExternalStore(
    noop,
    () => String(new Date().getFullYear()),
    () => "2026", // rendu serveur / prérendu
  );
  return <>{year}</>;
}
