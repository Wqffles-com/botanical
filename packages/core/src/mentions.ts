/** A named thing that can be @mentioned in a chat message. */
export interface Mentionable {
  id: string;
  name: string;
}

/** An `@Name` in a message, resolved to an agent. `start`/`end` cover the `@` and the name. */
export interface Mention<T extends Mentionable = Mentionable> {
  agent: T;
  start: number;
  end: number;
}

/**
 * Find `@Name` mentions of known agents. Names match case-insensitively and may contain spaces;
 * the longest name wins (`@Ada Lovelace` over `@Ada`). The `@` must start the text or follow
 * whitespace or an opening bracket, and the name must end at a non-word character, so emails
 * and `@Adam` for an agent named `Ada` do not match.
 */
export function findMentions<T extends Mentionable>(content: string, agents: readonly T[]): Mention<T>[] {
  const candidates = agents
    .filter((agent) => agent.name.trim().length > 0)
    .sort((a, b) => b.name.trim().length - a.name.trim().length);
  const mentions: Mention<T>[] = [];
  for (let index = content.indexOf("@"); index !== -1; index = content.indexOf("@", index + 1)) {
    if (index > 0 && !/[\s([{"'“]/.test(content[index - 1] as string)) continue;
    const rest = content.slice(index + 1).toLowerCase();
    for (const agent of candidates) {
      const name = agent.name.trim();
      if (!rest.startsWith(name.toLowerCase())) continue;
      const after = content[index + 1 + name.length];
      if (after !== undefined && /[\p{L}\p{N}_-]/u.test(after)) continue;
      mentions.push({ agent, start: index, end: index + 1 + name.length });
      index += name.length;
      break;
    }
  }
  return mentions;
}

/** The distinct agents mentioned in `content`, in first-mention order. */
export function mentionedAgents<T extends Mentionable>(content: string, agents: readonly T[]): T[] {
  const seen = new Map<string, T>();
  for (const mention of findMentions(content, agents)) {
    if (!seen.has(mention.agent.id)) seen.set(mention.agent.id, mention.agent);
  }
  return [...seen.values()];
}

/**
 * The mention being typed at `caret`: the text between an `@` and the caret, for autocomplete.
 * Null when the caret is not inside a mention. The query may contain single spaces.
 */
export function activeMentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at === -1) return null;
  if (at > 0 && !/[\s([{"'“]/.test(before[at - 1] as string)) return null;
  const query = before.slice(at + 1);
  if (query.length > 40 || /\n|\s\s|^\s/.test(query)) return null;
  return { start: at, query };
}
