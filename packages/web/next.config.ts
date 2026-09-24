import type { NextConfig } from "next";

const apiUrl = (process.env.BOTANICAL_API_URL ?? "http://localhost:8787").replace(/\/$/, "");

const nextConfig: NextConfig = {
  transpilePackages: ["@botanical/core"],
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
