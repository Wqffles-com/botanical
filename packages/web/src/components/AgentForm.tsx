import type { CreateAgentInput } from "@botanical/core";
import { useState } from "react";

export function AgentForm({
  pending,
  forceOpen,
  onCreate,
}: {
  pending: boolean;
  forceOpen: boolean;
  onCreate: (input: CreateAgentInput) => Promise<boolean>;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [tools, setTools] = useState("");

  const form = (
    <form
      className="bc-agent-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (pending || name.trim() === "" || systemPrompt.trim() === "") return;
        void onCreate({
          name,
          description,
          systemPrompt,
          toolIds: tools
            .split(",")
            .map((part) => part.trim())
            .filter(Boolean),
        }).then((ok) => {
          if (!ok) return;
          setName("");
          setDescription("");
          setSystemPrompt("");
          setTools("");
        });
      }}
    >
      <label className="bc-field">
        <span>Name</span>
        <input value={name} onChange={(event) => setName(event.target.value)} required />
      </label>
      <label className="bc-field">
        <span>Description</span>
        <input value={description} onChange={(event) => setDescription(event.target.value)} />
      </label>
      <label className="bc-field">
        <span>Prompt</span>
        <textarea rows={3} required value={systemPrompt} onChange={(event) => setSystemPrompt(event.target.value)} />
      </label>
      <label className="bc-field">
        <span>Tools</span>
        <input
          value={tools}
          placeholder="web_search, file_read"
          onChange={(event) => setTools(event.target.value)}
        />
      </label>
      <button
        className="bc-button bc-button--quiet"
        type="submit"
        disabled={pending || name.trim() === "" || systemPrompt.trim() === ""}
      >
        {pending ? "Saving…" : "Save agent"}
      </button>
    </form>
  );

  if (forceOpen) {
    return (
      <section className="bc-agent-create">
        <h3>New agent</h3>
        {form}
      </section>
    );
  }

  return (
    <details className="bc-agent-create">
      <summary>New agent</summary>
      {form}
    </details>
  );
}
