export function relativeTime(iso: string, now = Date.now()): string {
  const then = new Date(iso).getTime()
  const delta = Math.max(0, now - then)
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (delta < minute) return 'now'
  if (delta < hour) return `${Math.floor(delta / minute)}m`
  if (delta < day) return `${Math.floor(delta / hour)}h`
  if (delta < 7 * day) return `${Math.floor(delta / day)}d`
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase()
}

export function providerLabel(id: string): string {
  const labels: Record<string, string> = {
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    xai: 'xAI',
    deepseek: 'DeepSeek',
    openrouter: 'OpenRouter',
    custom: 'Custom',
  }
  return labels[id] ?? id
}

export function costLabel(tier: 'low' | 'mid' | 'high'): string {
  if (tier === 'low') return 'low'
  if (tier === 'mid') return 'mid'
  return 'high'
}

export function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
