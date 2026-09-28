import type { NextConfig } from "next";

// Baked into production rewrites. Compose builds the image with http://server:8787.
// Local `next dev` falls back to the API on this machine.
const apiUrl = (process.env.BOTANICAL_API_URL ?? "http://127.0.0.1:8787").replace(/\/+$/, "");

const nextConfig: NextConfig = {
  // The /api rewrite proxies text/event-stream. Gzip here buffers the whole SSE body
  // when the browser sends Accept-Encoding: gzip, so tokens arrive in one chunk.
  compress: false,
  // Proxy buffers request bodies (default 10 MB) before the /api rewrite. Dictation
  // uploads are allowed up to 25 MB plus multipart framing, so the cap sits above that.
  experimental: {
    proxyClientMaxBodySize: "32mb",
  },
  output: "standalone",
  outputFileTracingRoot: process.cwd().endsWith("/packages/web")
    ? process.cwd().slice(0, -"/packages/web".length)
    : process.cwd(),
  transpilePackages: ["@botanical/core", "geist"],
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
