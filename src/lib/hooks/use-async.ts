"use client";

import { useCallback, useEffect, useState } from "react";

export type AsyncState<T> =
  | { status: "loading" }
  | { status: "error"; error: Error }
  | { status: "success"; data: T };

/** Charge une donnée depuis lib/services avec états chargement / erreur. */
export function useAsync<T>(loader: () => Promise<T>) {
  const [state, setState] = useState<AsyncState<T>>({ status: "loading" });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    loader()
      .then((data) => !cancelled && setState({ status: "success", data }))
      .catch((error: Error) => !cancelled && setState({ status: "error", error }));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  const reload = useCallback(() => {
    setState({ status: "loading" });
    setTick((t) => t + 1);
  }, []);

  return { ...state, reload };
}
