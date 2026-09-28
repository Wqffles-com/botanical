"use client";

import { isUnauthorized, type AccentColor } from "@botanical/core";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { applyAccent, readStoredAccent, writeStoredAccent } from "@/lib/accent";

type AccentContextValue = {
  accent: AccentColor;
  setAccent: (accent: AccentColor) => Promise<void>;
  ready: boolean;
};

const AccentContext = createContext<AccentContextValue | null>(null);

export function AccentProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [accent, setAccentState] = useState<AccentColor>(DEFAULT_FALLBACK);
  const [ready, setReady] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    const id = ++requestId.current;
    const cached = readStoredAccent();
    setAccentState(cached);
    applyAccent(cached);
    api
      .getAppearance()
      .then((appearance) => {
        if (id !== requestId.current) return;
        setAccentState(appearance.accent);
        applyAccent(appearance.accent);
        writeStoredAccent(appearance.accent);
      })
      .catch((error: unknown) => {
        if (id !== requestId.current) return;
        if (isUnauthorized(error)) {
          setAccentState("neutral");
          applyAccent("neutral");
          writeStoredAccent("neutral");
        }
      })
      .finally(() => {
        if (id === requestId.current) setReady(true);
      });
  }, [pathname]);

  const value = useMemo<AccentContextValue>(
    () => ({
      accent,
      ready,
      async setAccent(next) {
        const saved = await api.updateAppearance(next);
        setAccentState(saved.accent);
        applyAccent(saved.accent);
        writeStoredAccent(saved.accent);
      },
    }),
    [accent, ready],
  );

  return <AccentContext.Provider value={value}>{children}</AccentContext.Provider>;
}

const DEFAULT_FALLBACK = "neutral" as const;

export function useAccent(): AccentContextValue {
  const value = useContext(AccentContext);
  if (!value) {
    return {
      accent: "neutral",
      ready: false,
      async setAccent() {
        throw new Error("Accent is only available inside the app.");
      },
    };
  }
  return value;
}
