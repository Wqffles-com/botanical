import type { ReactNode } from "react";

export const metadata = {
  title: "Botanical",
  description: "Botanical web",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
