import type { NextConfig } from "next";

// Baked into production rewrites. `next dev` reads this on each request.
// Compose builds the image with http://server:8787. Local dev defaults to the API port.
const apiOrigin = (process.env.BOTANICAL_API_URL ?? "http://127.0.0.1:8787").replace(/\/+$/, "");

const nextConfig: NextConfig = {
  output: "standalone",
  // Repo root, so the standalone trace includes workspace packages.
  outputFileTracingRoot: process.cwd().endsWith("/packages/web")
    ? process.cwd().slice(0, -"/packages/web".length)
    : process.cwd(),
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiOrigin}/api/:path*` }];
  },
};

export default nextConfig;
