import { describe, expect, test } from "bun:test";

import { htmlToMarkdown } from "../src/html-to-markdown.ts";

const article = `<!doctype html>
<html>
  <head>
    <title>Acme Docs</title>
    <style>.x { color: red; }</style>
    <script>window.secret = "do-not-leak";</script>
  </head>
  <body>
    <nav>Home Login</nav>
    <article>
      <h1>Getting started</h1>
      <p>Install the <a href="/docs/cli">CLI</a> and run <code>botanical init</code>.</p>
      <ul>
        <li>One</li>
        <li>Two</li>
      </ul>
      <pre><code class="language-ts">const n = 1;</code></pre>
      <p>See <strong>warnings</strong> &amp; notes. Use <code>a\`b</code>.</p>
      <p><a href="javascript:alert(1)">click</a></p>
    </article>
    <footer>secret-footer</footer>
  </body>
</html>`;

describe("htmlToMarkdown", () => {
  test("extracts article content and drops scripts, nav, and footer", () => {
    const extracted = htmlToMarkdown(article, "https://example.com/guide");
    expect(extracted.title).toBe("Acme Docs");
    expect(extracted.markdown).toContain("# Getting started");
    expect(extracted.markdown).toContain("[CLI](https://example.com/docs/cli)");
    expect(extracted.markdown).toContain("`botanical init`");
    expect(extracted.markdown).toContain("- One");
    expect(extracted.markdown).toContain("- Two");
    expect(extracted.markdown).toContain("```ts\nconst n = 1;\n```");
    expect(extracted.markdown).toContain("See **warnings** & notes.");
    expect(extracted.markdown).toContain("``a`b``");
    expect(extracted.markdown).toContain("click");
    expect(extracted.markdown).not.toContain("javascript:");
    expect(extracted.markdown).not.toContain("do-not-leak");
    expect(extracted.markdown).not.toContain("secret-footer");
    expect(extracted.markdown).not.toContain("Home Login");
    expect(extracted.markdown).not.toContain("color: red");
  });

  test("prefers the densest paragraph block over a short menu", () => {
    const html = `<body>
      <div id="wrap">
        <div id="menu">Home About Contact</div>
        <div id="story">
          <p>Botanical is a personal agent server with tools, providers, and a web client for long running work.</p>
          <p>The second paragraph keeps going so the extractor can prefer this block over the short menu above it.</p>
        </div>
      </div>
    </body>`;
    const extracted = htmlToMarkdown(html, "https://example.com/");
    expect(extracted.markdown).toContain("second paragraph");
    expect(extracted.markdown).not.toContain("Home About Contact");
  });

  test("renders a simple table", () => {
    const extracted = htmlToMarkdown(
      `<table><thead><tr><th>Name</th><th>Role</th></tr></thead><tbody><tr><td>Ash</td><td>Guide</td></tr></tbody></table>`,
      "https://example.com/",
    );
    expect(extracted.markdown).toContain("| Name | Role |");
    expect(extracted.markdown).toContain("| --- | --- |");
    expect(extracted.markdown).toContain("| Ash | Guide |");
  });
});
