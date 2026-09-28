"use client";

import type { AccentColor } from "@botanical/core";
import { useState } from "react";
import { toast } from "sonner";
import { useAccent } from "@/components/accent-provider";
import { Button } from "@botanical/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@botanical/ui/components/card";
import { Switch } from "@botanical/ui/components/switch";
import { ACCENT_COLORS, ACCENT_LABEL, ACCENT_SWATCH } from "@/lib/accent";
import { cn } from "@/lib/utils";

export function AccentCard() {
  const { accent, setAccent } = useAccent();
  const [pending, setPending] = useState<AccentColor | null>(null);
  const shown = pending ?? accent;

  async function choose(next: AccentColor) {
    if (next === accent || pending) return;
    setPending(next);
    try {
      await setAccent(next);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the accent.");
    } finally {
      setPending(null);
    }
  }

  return (
    <Card data-testid="accent-picker">
      <CardHeader>
        <CardTitle>Accent</CardTitle>
        <CardDescription>
          Colors buttons, links, focus rings, and switches. The sidebar and page stay black, white, and gray.
          Neutral keeps the current monochrome primary.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div role="radiogroup" aria-label="Accent color" className="flex flex-wrap gap-2">
          {ACCENT_COLORS.map((color) => {
            const selected = color === shown;
            return (
              <button
                key={color}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={ACCENT_LABEL[color]}
                disabled={pending !== null}
                onClick={() => void choose(color)}
                className={cn(
                  "flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm ring-offset-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
                  selected ? "border-foreground" : "border-border",
                )}
              >
                <span
                  className="size-4 rounded-full border border-foreground/20"
                  style={{
                    background: color === "neutral" ? "var(--foreground)" : ACCENT_SWATCH[color],
                  }}
                />
                {ACCENT_LABEL[color]}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button">Primary button</Button>
          <Button type="button" variant="link" className="px-0">
            Link
          </Button>
          <span className="flex items-center gap-2 text-sm">
            <Switch checked onCheckedChange={() => undefined} aria-label="Switch preview" />
            Switch
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
