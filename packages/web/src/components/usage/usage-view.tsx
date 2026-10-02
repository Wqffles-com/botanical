"use client";

import type { UsagePrices, UsageResponse, UsageRow } from "@botanical/core";
import { isUnauthorized } from "@botanical/core";
import { Button } from "@botanical/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@botanical/ui/components/card";
import { Input } from "@botanical/ui/components/input";
import { pageContainerVariants } from "@botanical/ui/components/page-container";
import { PageHeader } from "@botanical/ui/components/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@botanical/ui/components/select";
import { Skeleton } from "@botanical/ui/components/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@botanical/ui/components/table";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useWorkspace } from "@/components/workspace-provider";
import { api } from "@/lib/api";
import { errorText } from "@/lib/errors";
import { formatCount } from "@/lib/chat-details";
import {
  draftsFromOverrides,
  formatTokens,
  formatUsd,
  overridesFromDrafts,
  type PriceDraft,
} from "@/lib/usage-format";

const RANGES = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
];

const SCOPES = [
  { value: "own", label: "My usage" },
  { value: "all", label: "Everyone" },
];

export function UsageView() {
  const { me } = useWorkspace();
  const isAdmin = me?.user?.role === "admin";
  const [days, setDays] = useState("30");
  const [scope, setScope] = useState<"own" | "all">("own");
  const [data, setData] = useState<UsageResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void api
      .getUsage({ days: Number(days), scope })
      .then((next) => {
        if (cancelled) return;
        setData(next);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled || isUnauthorized(err)) return;
        setError(errorText(err));
      });
    return () => {
      cancelled = true;
    };
  }, [days, scope, reloads]);

  const report = data?.report;
  return (
    <div className={pageContainerVariants()}>
      <PageHeader
        title="Usage"
        description="Tokens and estimated cost. Cost is an estimate from the price table below, not a bill."
        actions={
          <div className="flex gap-2">
            {isAdmin ? (
              <Select items={SCOPES} value={scope} onValueChange={(next) => next && setScope(next as "own" | "all")}>
                <SelectTrigger aria-label="Whose usage" className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCOPES.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            <Select items={RANGES} value={days} onValueChange={(next) => next && setDays(next)}>
              <SelectTrigger aria-label="Time range" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RANGES.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      />
      {error ? (
        <p role="alert" className="mt-6 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {!report ? (
        error ? null : (
          <div className="mt-6 space-y-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        )
      ) : (
        <div className="mt-6 space-y-6">
          <Summary totals={report.totals} />
          <DailyChart rows={report.byDay} />
          <div className="grid gap-6 lg:grid-cols-2">
            <Breakdown title="By agent" rows={report.byAgent} />
            <Breakdown title="By profile and model" rows={report.byModel} />
            <Breakdown title="By source" rows={report.bySource} />
            {data?.scope === "all" ? <Breakdown title="By user" rows={report.byUser} /> : null}
          </div>
          {isAdmin && data ? (
            <PriceEditor prices={data.prices} onSaved={() => setReloads((count) => count + 1)} />
          ) : null}
        </div>
      )}
    </div>
  );
}

function Summary({ totals }: { totals: UsageRow }) {
  const tiles = [
    { label: "Estimated cost", value: formatUsd(totals.costUsd) },
    { label: "Tokens in", value: formatTokens(totals.inputTokens) },
    { label: "Tokens out", value: formatTokens(totals.outputTokens) },
    { label: "Model calls", value: formatCount(totals.calls) },
  ];
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map((tile) => (
          <Card key={tile.label} size="sm">
            <CardHeader>
              <CardDescription>{tile.label}</CardDescription>
              <CardTitle className="text-2xl tabular-nums">{tile.value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>
      {totals.unpricedCalls > 0 ? (
        <p className="text-sm text-muted-foreground">
          {formatCount(totals.unpricedCalls)} {totals.unpricedCalls === 1 ? "call has" : "calls have"} no price, so the
          cost leaves {totals.unpricedCalls === 1 ? "it" : "them"} out. Add a price below to include{" "}
          {totals.unpricedCalls === 1 ? "it" : "them"}.
        </p>
      ) : null}
    </div>
  );
}

function DailyChart({ rows }: { rows: UsageRow[] }) {
  const peak = Math.max(1, ...rows.map((row) => row.inputTokens + row.outputTokens));
  return (
    <Card>
      <CardHeader>
        <CardTitle>By day</CardTitle>
        <CardDescription>Input plus output tokens. Days are UTC.</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No model calls in this range.</p>
        ) : (
          <ul className="space-y-1.5">
            {rows.map((row) => {
              const total = row.inputTokens + row.outputTokens;
              return (
                <li key={row.key} className="grid grid-cols-[5.5rem_1fr_9rem] items-center gap-3 text-sm">
                  <span className="tabular-nums text-muted-foreground">{row.label}</span>
                  <div className="h-2 rounded-full bg-muted" role="img" aria-label={`${formatCount(total)} tokens`}>
                    <div className="h-2 rounded-full bg-primary" style={{ width: `${(total / peak) * 100}%` }} />
                  </div>
                  <span className="text-right tabular-nums">
                    {formatTokens(total)} · {formatUsd(row.costUsd)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function Breakdown({ title, rows }: { title: string; rows: UsageRow[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="text-right">In</TableHead>
                <TableHead className="text-right">Out</TableHead>
                <TableHead className="text-right">Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.key}>
                  <TableCell className="max-w-48 truncate">{row.label}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatTokens(row.inputTokens)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatTokens(row.outputTokens)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatUsd(row.costUsd)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function PriceEditor({ prices, onSaved }: { prices: UsagePrices; onSaved: () => void }) {
  const [drafts, setDrafts] = useState<PriceDraft[]>(() => draftsFromOverrides(prices.overrides));
  const [saving, setSaving] = useState(false);

  function update(index: number, patch: Partial<PriceDraft>) {
    setDrafts((current) => current.map((draft, i) => (i === index ? { ...draft, ...patch } : draft)));
  }

  async function save() {
    const parsed = overridesFromDrafts(drafts);
    if ("error" in parsed) {
      toast.error(parsed.error);
      return;
    }
    setSaving(true);
    try {
      const saved = await api.setUsagePrices(parsed.overrides);
      setDrafts(draftsFromOverrides(saved.overrides));
      onSaved();
      toast.success("Prices saved. Totals use them for past calls too.");
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Price table</CardTitle>
        <CardDescription>
          USD per million tokens, matched by model name prefix (the longest match wins). Overrides replace the built-in
          estimates and apply to past calls.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1 text-sm text-muted-foreground">
          {Object.entries(prices.defaults).map(([prefix, price]) => (
            <p key={prefix} className="tabular-nums">
              {prefix}: ${price.inputPerMTok} in, ${price.outputPerMTok} out (built-in)
            </p>
          ))}
        </div>
        <div className="space-y-2">
          {drafts.map((draft, index) => (
            <div key={index} className="grid grid-cols-[1fr_6rem_6rem_auto] items-center gap-2">
              <Input
                aria-label="Model name prefix"
                placeholder="Model name, e.g. gpt-5"
                value={draft.prefix}
                onChange={(event) => update(index, { prefix: event.target.value })}
              />
              <Input
                aria-label="Input price per million tokens"
                inputMode="decimal"
                placeholder="In"
                value={draft.input}
                onChange={(event) => update(index, { input: event.target.value })}
              />
              <Input
                aria-label="Output price per million tokens"
                inputMode="decimal"
                placeholder="Out"
                value={draft.output}
                onChange={(event) => update(index, { output: event.target.value })}
              />
              <Button variant="ghost" onClick={() => setDrafts((current) => current.filter((_, i) => i !== index))}>
                Remove
              </Button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setDrafts((current) => [...current, { prefix: "", input: "", output: "" }])}>
            Add price
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : "Save prices"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
