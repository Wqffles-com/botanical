import type { NextConfig } from "next";

// Baked into production rewrites. Compose builds the image with http://server:8787.
// Local `next dev` falls back to the API on this machine.
const apiUrl = (process.env.BOTANICAL_API_URL ?? "http://127.0.0.1:8787").replace(/\/+$/, "");

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: process.cwd().endsWith("/packages/web")
    ? process.cwd().slice(0, -"/packages/web".length)
    : process.cwd(),
  transpilePackages: ["@botanical/core"],
  agentRules: false,
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${apiUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
