import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Providers } from "@/components/providers";
import { cn } from "@/lib/utils";
import "./globals.css";

export const metadata: Metadata = {
  title: "Botanical",
  description: "Always-on AI agent server. Any model.",
  icons: {
    icon: { url: "/favicon.svg", type: "image/svg+xml" },
    apple: { url: "/apple-touch-icon.png", sizes: "180x180" },
  },
  appleWebApp: { capable: true, title: "Botanical", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = { themeColor: "#0c121b" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={cn("font-sans", GeistSans.variable, GeistMono.variable)}
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var a=localStorage.getItem('botanical.accent');if(a&&a!=='neutral')document.documentElement.dataset.accent=a;}catch(e){}",
          }}
        />
      </head>
      <body className="min-h-svh antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
