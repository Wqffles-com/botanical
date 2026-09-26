"use client";

import { Check, Copy } from "lucide-react";
import { useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function Markdown({ children, className }: { children: string; className?: string }) {
  if (!children) return null;
  return (
    <div className={cn("space-y-3 text-[14.5px] leading-[1.55] break-words", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="whitespace-pre-wrap">{children}</p>,
          a: ({ href, children }) => (
            <a href={href} className="text-primary underline-offset-2 hover:underline" target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
          ul: ({ children }) => <ul className="list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5">{children}</ol>,
          li: ({ children }) => <li className="whitespace-pre-wrap">{children}</li>,
          h1: ({ children }) => <h1 className="text-lg font-medium">{children}</h1>,
          h2: ({ children }) => <h2 className="text-base font-medium">{children}</h2>,
          h3: ({ children }) => <h3 className="text-sm font-medium">{children}</h3>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-primary/40 pl-3 text-muted-foreground">{children}</blockquote>
          ),
          code: ({ className: codeClass, children }) => {
            const text = nodeText(children);
            const language = /language-(\w+)/.exec(codeClass ?? "")?.[1];
            const fenced = Boolean(codeClass) || text.includes("\n");
            if (!fenced) {
              return (
                <code className="rounded-[4px] bg-muted px-1 py-0.5 font-mono text-[12.5px] text-primary">
                  {text}
                </code>
              );
            }
            return <CodeBlock language={language} code={text.replace(/\n$/, "")} />;
          },
          pre: ({ children }) => <>{children}</>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

function CodeBlock({ language, code }: { language?: string; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="my-2 overflow-hidden rounded-md border bg-background">
      <div className="flex items-center justify-between border-b px-3 py-1 text-[11px] uppercase tracking-wide text-muted-foreground">
        <span>{language || "code"}</span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={async () => {
            await navigator.clipboard.writeText(code);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1200);
          }}
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-[12.5px] leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function nodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (node && typeof node === "object" && "props" in node) {
    return nodeText((node as { props?: { children?: ReactNode } }).props?.children);
  }
  return "";
}
