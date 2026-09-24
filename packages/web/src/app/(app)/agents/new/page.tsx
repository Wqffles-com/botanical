"use client";

import { BotanicalApiError } from "@botanical/core";
import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { AgentAvatar } from "@/components/agent-avatar";
import { PageHeader } from "@/components/page-header";
import { useWorkspace } from "@/components/workspace-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AGENT_COLORS, AGENT_COLOR_TOKENS, type AgentColor } from "@/lib/agent-colors";
import { AGENT_ICON_NAMES, DEFAULT_AGENT_ICON, type AgentIconName } from "@/lib/agent-icons";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

export default function NewAgentPage() {
  const router = useRouter();
  const { refresh } = useWorkspace();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [prompt, setPrompt] = useState("You are a Botanical agent.");
  const [icon, setIcon] = useState<AgentIconName>(DEFAULT_AGENT_ICON);
  const [color, setColor] = useState<AgentColor>("green");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const created = await api.createAgent({
        name,
        description,
        systemPrompt: prompt,
        toolIds: [],
      });
      await refresh();
      router.replace(`/agents/${created.id}`);
    } catch (cause) {
      setError(cause instanceof BotanicalApiError ? cause.message : "Could not create the agent.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl p-8">
      <PageHeader
        title="New agent"
        description="Name, prompt, icon, and color. Tool allowlists land with the identity UI."
      />
      <Card className="mt-8">
        <CardContent>
          <form onSubmit={(event) => void onSubmit(event)} className="grid gap-5">
            <div className="flex items-center gap-3">
              <AgentAvatar icon={icon} color={color} name={name || "New agent"} size="lg" />
              <p className="text-sm text-muted-foreground">Preview of this agent’s tile.</p>
            </div>
            <Field label="Name">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Greenhouse" />
            </Field>
            <Field label="Description" hint="Shown in pickers">
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What this agent is for"
              />
            </Field>
            <Field label="Color">
              <div className="flex flex-wrap gap-2">
                {AGENT_COLORS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-label={value}
                    onClick={() => setColor(value)}
                    className={cn(
                      "size-6 rounded-md ring-offset-background",
                      color === value && "ring-2 ring-foreground",
                    )}
                    style={{ background: AGENT_COLOR_TOKENS[value].fill }}
                  />
                ))}
              </div>
            </Field>
            <Field label="Icon">
              <select
                value={icon}
                onChange={(e) => setIcon(e.target.value as AgentIconName)}
                className="h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm"
              >
                {AGENT_ICON_NAMES.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="System prompt">
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={10}
                className="font-mono text-[13px] leading-relaxed"
              />
            </Field>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <div className="flex justify-end gap-2">
              <Button type="submit" disabled={pending || !name.trim() || !prompt.trim()}>
                {pending ? "Saving…" : "Create agent"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <span className="flex items-baseline justify-between">
        <Label>{label}</Label>
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </span>
      {children}
    </div>
  );
}
