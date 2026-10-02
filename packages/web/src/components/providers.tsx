"use client";

import { useEffect, type ReactNode } from "react";
import { AccentProvider } from "@/components/accent-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@botanical/ui/components/sonner";
import { TooltipProvider } from "@botanical/ui/components/tooltip";
import { registerServiceWorker } from "@/lib/push";

export function Providers({ children }: { children: ReactNode }) {
  useEffect(() => registerServiceWorker(), []);
  return (
    <ThemeProvider>
      <AccentProvider>
        <TooltipProvider>
          {children}
          <Toaster position="bottom-right" />
        </TooltipProvider>
      </AccentProvider>
    </ThemeProvider>
  );
}
