#!/usr/bin/env bun
/**
 * The web image always runs `next build` with output: "standalone".
 * When packages/web is already the Next app, this only fills that setting in
 * if the config forgot it. A missing App Router shell is written in the image
 * build so the Dockerfile still produces a server before the UI lands.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const layoutSource = `import type { ReactNode } from "react";

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
`;

const pageSource = `export default function HomePage() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: "40rem" }}>
      <h1>Botanical</h1>
      <p>The web container is up. App routes from the Next.js UI replace this shell.</p>
    </main>
  );
}
`;

const configSource = `import type { NextConfig } from "next";

const apiOrigin = (process.env.BOTANICAL_API_URL ?? "http://127.0.0.1:8787").replace(/\\/+$/, "");

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: process.cwd().endsWith("/packages/web")
    ? process.cwd().slice(0, -"/packages/web".length)
    : process.cwd(),
  async rewrites() {
    return [{ source: "/api/:path*", destination: \`\${apiOrigin}/api/:path*\` }];
  },
};

export default nextConfig;
`;

const root = process.cwd();
const web = join(root, "packages/web");
const pkgPath = join(web, "package.json");

if (!existsSync(pkgPath)) {
  console.error("botanical: packages/web/package.json is missing");
  process.exit(1);
}

const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const declared = { ...pkg.dependencies, ...pkg.devDependencies };

if (!declared.next) {
  console.log("botanical: installing next@15 in packages/web for the image build");
  const add = spawnSync("bun", ["add", "next@15"], { cwd: web, stdio: "inherit" });
  if (add.status !== 0) process.exit(add.status ?? 1);
}

const appDirs = ["app", "src/app", "pages", "src/pages"];
if (!appDirs.some((dir) => existsSync(join(web, dir)))) {
  mkdirSync(join(web, "app"), { recursive: true });
  writeFileSync(join(web, "app/layout.tsx"), layoutSource);
  writeFileSync(join(web, "app/page.tsx"), pageSource);
  console.log("botanical: wrote a minimal App Router shell under packages/web/app");
}

const configOrder = ["next.config.js", "next.config.mjs", "next.config.ts", "next.config.cjs"];
const configPath = configOrder.map((name) => join(web, name)).find((file) => existsSync(file));

if (!configPath) {
  writeFileSync(join(web, "next.config.ts"), configSource);
  console.log("botanical: wrote packages/web/next.config.ts");
} else {
  ensureStandalone(configPath);
}

function ensureStandalone(file) {
  const text = readFileSync(file, "utf8");
  if (text.includes('output: "standalone"') || text.includes("output: 'standalone'")) {
    console.log(`botanical: ${file} already sets standalone output`);
    return;
  }
  let next = text;
  if (/export default \{/.test(next)) {
    next = next.replace("export default {", 'export default {\n  output: "standalone",');
  } else if (/const nextConfig\s*(?::[^=]+)?=\s*\{/.test(next)) {
    next = next.replace(
      /const nextConfig\s*(?::[^=]+)?=\s*\{/,
      'const nextConfig = {\n  output: "standalone",',
    );
  } else if (/module\.exports\s*=\s*\{/.test(next)) {
    next = next.replace(/module\.exports\s*=\s*\{/, 'module.exports = {\n  output: "standalone",');
  } else {
    console.error(`botanical: add output: "standalone" to ${file} so the web image can run`);
    process.exit(1);
  }
  writeFileSync(file, next);
  console.log(`botanical: injected output standalone into ${file}`);
}
