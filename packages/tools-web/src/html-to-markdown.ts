import { parseHTML } from "linkedom";

export interface HtmlExtract {
  title: string;
  markdown: string;
}

interface NodeLike {
  nodeType: number;
  nodeValue: string | null;
  textContent: string | null;
  childNodes: Iterable<NodeLike>;
}

interface Elm extends NodeLike {
  tagName: string;
  children: ArrayLike<Elm>;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
  querySelector(selector: string): Elm | null;
  querySelectorAll(selector: string): ArrayLike<Elm>;
  cloneNode(deep?: boolean): Elm;
  remove(): void;
}

interface Doc {
  body: Elm | null;
  documentElement: Elm | null;
  querySelector(selector: string): Elm | null;
}

interface RenderCtx {
  baseUrl: string;
}

const SKIP = new Set([
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "canvas",
  "iframe",
  "object",
  "embed",
  "link",
  "meta",
  "head",
  "nav",
  "footer",
  "aside",
  "input",
  "textarea",
  "select",
  "button",
]);

/**
 * Turn an HTML document into markdown.
 * Prefers `<article>` or `<main>` when they hold real text, otherwise the
 * densest block of paragraphs. Scripts, styles, and navigation are dropped.
 */
export function htmlToMarkdown(html: string, baseUrl: string): HtmlExtract {
  const { document } = parseHTML(html);
  const doc = document as unknown as Doc;
  const title = readTitle(doc);
  const root = pickRoot(doc);
  if (!root) return { title, markdown: "" };
  const rendered = finalize(renderNode(root, { baseUrl }));
  if (rendered) return { title, markdown: rendered };
  return { title, markdown: plainText(root) };
}

function readTitle(doc: Doc): string {
  const titled = collapseWs(doc.querySelector("title")?.textContent ?? "");
  if (titled) return titled;
  return collapseWs(doc.querySelector("h1")?.textContent ?? "");
}

function pickRoot(doc: Doc): Elm | null {
  const article = doc.querySelector("article");
  if (article && readableLength(article) >= 80) return article;
  const main = doc.querySelector("main");
  if (main && readableLength(main) >= 80) return main;
  // Fragments sometimes become documentElement while `document.body` stays empty.
  const body = richer(doc.body, doc.documentElement);
  if (!body) return null;
  const dense = pickDense(body);
  if (dense && readableLength(dense) >= readableLength(body) * 0.4) return dense;
  return body;
}

function richer(primary: Elm | null, fallback: Elm | null): Elm | null {
  if (!primary) return fallback;
  if (!fallback || primary === fallback) return primary;
  return readableLength(fallback) > readableLength(primary) ? fallback : primary;
}

function pickDense(root: Elm): Elm | null {
  let best: Elm | null = null;
  let bestScore = 0;
  for (const el of Array.from(root.querySelectorAll("div, section"))) {
    const score = paragraphScore(el);
    if (score < 80) continue;
    if (!best || score > bestScore) {
      best = el;
      bestScore = score;
      continue;
    }
    if (score === bestScore && containsElement(best, el)) best = el;
  }
  return best;
}

function paragraphScore(el: Elm): number {
  let score = 0;
  for (const paragraph of Array.from(el.querySelectorAll("p"))) {
    score += collapseWs(paragraph.textContent ?? "").length;
  }
  return score;
}

function containsElement(parent: Elm, child: Elm): boolean {
  for (const el of Array.from(parent.querySelectorAll("div, section"))) {
    if (el === child) return true;
  }
  return false;
}

function readableLength(el: Elm): number {
  return plainText(el).length;
}

function plainText(root: Elm): string {
  const clone = root.cloneNode(true);
  for (const tag of SKIP) {
    for (const el of Array.from(clone.querySelectorAll(tag))) el.remove();
  }
  return collapseWs(clone.textContent ?? "");
}

function renderNode(node: NodeLike, ctx: RenderCtx): string {
  if (node.nodeType === 3) return node.nodeValue ?? "";
  if (node.nodeType !== 1) return "";
  const el = node as Elm;
  const tag = el.tagName.toLowerCase();
  if (SKIP.has(tag) || el.hasAttribute("hidden")) return "";
  const role = el.getAttribute("role")?.toLowerCase();
  if (role === "navigation" || role === "contentinfo") return "";

  switch (tag) {
    case "br":
      return "\n";
    case "hr":
      return "\n\n---\n\n";
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6": {
      const level = el.tagName.toLowerCase().charCodeAt(1) - 48;
      const text = inlineText(renderChildren(el, ctx));
      if (!text) return "";
      return `\n\n${"#".repeat(level)} ${text}\n\n`;
    }
    case "p":
    case "figcaption":
    case "dd": {
      const text = inlineText(renderChildren(el, ctx));
      return text ? `\n\n${text}\n\n` : "";
    }
    case "dt": {
      const text = inlineText(renderChildren(el, ctx));
      return text ? `\n\n**${text}**\n\n` : "";
    }
    case "a": {
      const href = safeHref(el.getAttribute("href"), ctx.baseUrl);
      const text = inlineText(renderChildren(el, ctx));
      if (!href) return text;
      if (!text || text === href) return `[${href}](${href})`;
      return `[${text}](${href})`;
    }
    case "img": {
      const alt = collapseWs(el.getAttribute("alt") ?? "");
      const src = safeHref(el.getAttribute("src"), ctx.baseUrl);
      if (!src) return alt;
      return `![${alt}](${src})`;
    }
    case "strong":
    case "b": {
      const text = inlineText(renderChildren(el, ctx));
      return text ? `**${text}**` : "";
    }
    case "em":
    case "i": {
      const text = inlineText(renderChildren(el, ctx));
      return text ? `*${text}*` : "";
    }
    case "code":
      return inlineCode(el.textContent ?? "");
    case "pre":
      return renderPre(el);
    case "ul":
      return renderList(el, false, 0, ctx);
    case "ol":
      return renderList(el, true, 0, ctx);
    case "li":
      return renderChildren(el, ctx);
    case "blockquote": {
      const text = inlineText(renderChildren(el, ctx));
      if (!text) return "";
      return `\n\n${text.split("\n").map((line) => `> ${line}`).join("\n")}\n\n`;
    }
    case "table":
      return renderTable(el, ctx);
    default:
      return renderChildren(el, ctx);
  }
}

function renderChildren(el: Elm, ctx: RenderCtx): string {
  let out = "";
  for (const child of el.childNodes) out += renderNode(child, ctx);
  return out;
}

function renderPre(el: Elm): string {
  const codeEl = el.querySelector("code");
  const className = codeEl?.getAttribute("class") ?? el.getAttribute("class") ?? "";
  const lang = /(?:language|lang)-([\w+-]+)/i.exec(className)?.[1] ?? "";
  const code = (codeEl?.textContent ?? el.textContent ?? "").replace(/\n$/, "");
  const fence = "`".repeat(Math.max(3, longestBackticks(code) + 1));
  return `\n\n${fence}${lang}\n${code}\n${fence}\n\n`;
}

function renderList(el: Elm, ordered: boolean, depth: number, ctx: RenderCtx): string {
  const items = childElements(el).filter((child) => child.tagName.toLowerCase() === "li");
  if (items.length === 0) return "";
  const startRaw = el.getAttribute("start");
  const start = startRaw && /^\d+$/.test(startRaw) ? Number(startRaw) : 1;
  const pad = "  ".repeat(depth);
  const lines = items.map((item, index) => {
    const marker = ordered ? `${start + index}. ` : "- ";
    const inner = renderListItem(item, depth, ctx);
    const indented = inner.replace(/\n/g, `\n${pad}${" ".repeat(marker.length)}`);
    return `${pad}${marker}${indented}`;
  });
  return `\n\n${lines.join("\n")}\n\n`;
}

function renderListItem(item: Elm, depth: number, ctx: RenderCtx): string {
  const parts: string[] = [];
  let inline = "";
  const flush = () => {
    const text = inlineText(inline);
    if (text) parts.push(text);
    inline = "";
  };
  for (const child of item.childNodes) {
    if (isElement(child) && (child.tagName.toLowerCase() === "ul" || child.tagName.toLowerCase() === "ol")) {
      flush();
      parts.push(renderList(child, child.tagName.toLowerCase() === "ol", depth + 1, ctx).trim());
      continue;
    }
    inline += renderNode(child, ctx);
  }
  flush();
  return parts.join("\n");
}

function renderTable(table: Elm, ctx: RenderCtx): string {
  const rows = directRows(table).map((row) => directCells(row).map((cell) => cellText(cell, ctx)));
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  if (width === 0) return "";
  const normalized = rows.map((row) => {
    const copy = row.slice();
    while (copy.length < width) copy.push("");
    return copy;
  });
  const header = normalized[0];
  if (!header) return "";
  const lines = [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...normalized.slice(1).map((row) => `| ${row.join(" | ")} |`),
  ];
  return `\n\n${lines.join("\n")}\n\n`;
}

function cellText(cell: Elm, ctx: RenderCtx): string {
  return inlineText(renderChildren(cell, ctx)).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function directRows(table: Elm): Elm[] {
  const rows: Elm[] = [];
  for (const child of childElements(table)) {
    const tag = child.tagName.toLowerCase();
    if (tag === "tr") rows.push(child);
    if (tag === "thead" || tag === "tbody" || tag === "tfoot") {
      for (const row of childElements(child)) {
        if (row.tagName.toLowerCase() === "tr") rows.push(row);
      }
    }
  }
  return rows;
}

function directCells(row: Elm): Elm[] {
  return childElements(row).filter((cell) => {
    const tag = cell.tagName.toLowerCase();
    return tag === "td" || tag === "th";
  });
}

function childElements(el: Elm): Elm[] {
  return Array.from(el.children ?? []);
}

function isElement(node: NodeLike): node is Elm {
  return node.nodeType === 1 && "tagName" in node;
}

function safeHref(raw: string | null, baseUrl: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  if (/^(javascript|data|vbscript):/i.test(trimmed)) return null;
  try {
    const url = new URL(trimmed, baseUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.username = "";
    url.password = "";
    return url.href;
  } catch {
    return null;
  }
}

function inlineCode(text: string): string {
  if (!text) return "";
  const fence = "`".repeat(Math.max(1, longestBackticks(text) + 1));
  const body = text.startsWith("`") || text.endsWith("`") ? ` ${text} ` : text;
  return `${fence}${body}${fence}`;
}

function longestBackticks(text: string): number {
  const runs = text.match(/`+/g);
  if (!runs) return 0;
  let longest = 0;
  for (const run of runs) longest = Math.max(longest, run.length);
  return longest;
}

function inlineText(value: string): string {
  return value
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function finalize(value: string): string {
  return value.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function collapseWs(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
