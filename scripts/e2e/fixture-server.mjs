import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const fixtureHtml = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "fixture.html"), "utf8");

/**
 * In-memory stand-in for the MVP shell. It implements the same routes and
 * labels the Playwright suite drives, so `node scripts/e2e/run.mjs --self-test`
 * can prove the suite runs without the Docker stack.
 */
export function startFixture(passcode) {
  const body = fixtureHtml.replaceAll("__PASSCODE_JSON__", JSON.stringify(passcode).replace(/</g, "\\u003c"));
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname.includes(".")) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("not found");
      return;
    }
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(body);
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close() {
          return new Promise((done) => {
            server.close(() => done());
          });
        },
      });
    });
  });
}
