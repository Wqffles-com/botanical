import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Botanical",
    short_name: "Botanical",
    description: "Always-on AI agent server. Any model.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0c121b",
    theme_color: "#0c121b",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
