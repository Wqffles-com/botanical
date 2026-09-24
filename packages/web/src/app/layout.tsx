import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Geist, Instrument_Serif } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { WorkspaceProvider } from "@/components/workspace/workspace-provider";
import { cn } from "@/lib/utils";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });
const serif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-heading",
});

export const metadata: Metadata = {
  title: "Botanical",
  description: "Personal hosted agent server with streaming chat and tools.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={cn("font-sans", geist.variable, serif.variable)} suppressHydrationWarning>
      <body>
        <ThemeProvider>
          <WorkspaceProvider>
            {children}
            <Toaster />
          </WorkspaceProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
