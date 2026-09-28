"use client";

import type { ReactNode } from "react";
import { AccentProvider } from "@/components/accent-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@botanical/ui/components/sonner";
import { TooltipProvider } from "@botanical/ui/components/tooltip";

export function Providers({ children }: { children: ReactNode }) {
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
