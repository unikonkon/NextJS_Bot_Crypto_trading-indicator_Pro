"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * useState that is remembered in localStorage (per browser).
 * Renders `initial` on the server and first client paint, then hydrates.
 */
export function useLocalState<T>(key: string, initial: T): [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(initial);
  const loaded = useRef(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) {
        const parsed = JSON.parse(raw) as T;
        // Merge plain objects so newly added fields keep their defaults
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && initial && typeof initial === "object" && !Array.isArray(initial)) {
          setValue({ ...initial, ...parsed });
        } else {
          setValue(parsed);
        }
      }
    } catch {
      /* storage unavailable or corrupt — keep default */
    }
    loaded.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const set = useCallback((v: T | ((prev: T) => T)) => {
    setValue((prev) => {
      const next = typeof v === "function" ? (v as (p: T) => T)(prev) : v;
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, [key]);

  return [value, set];
}
