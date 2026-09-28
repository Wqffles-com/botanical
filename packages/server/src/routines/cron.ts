import { Cron } from "croner";

const MIN_GAP_MS = 60_000;

export interface ScheduleCheck {
  ok: boolean;
  error?: string;
  next: string[];
}

/** Five-field cron, no faster than once a minute, in a real IANA timezone. */
export function checkSchedule(expression: string, timezone: string, after: Date = new Date(), count = 5): ScheduleCheck {
  const cron = normalizeCron(expression);
  const zone = timezone.trim();
  if (!cron) return { ok: false, error: "Cron expression is required", next: [] };
  if (!zone) return { ok: false, error: "Timezone is required", next: [] };
  const zoneError = timezoneError(zone);
  if (zoneError) return { ok: false, error: zoneError, next: [] };
  const fields = cron.split(" ");
  if (fields.length !== 5) {
    return {
      ok: false,
      error: "Use a 5-field cron expression (minute hour day month weekday). Schedules more frequent than once a minute are not allowed.",
      next: [],
    };
  }
  let job: Cron;
  try {
    job = new Cron(cron, { timezone: zone, paused: true, protect: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid cron expression";
    return { ok: false, error: message, next: [] };
  }
  try {
    const runs = collectRuns(job, after, Math.max(count, 2));
    if (runs.length === 0) return { ok: false, error: "Schedule has no upcoming run", next: [] };
    for (let index = 1; index < runs.length; index += 1) {
      const gap = runs[index]!.getTime() - runs[index - 1]!.getTime();
      if (gap < MIN_GAP_MS) {
        return {
          ok: false,
          error: "Schedules more frequent than once a minute are not allowed.",
          next: [],
        };
      }
    }
    return { ok: true, next: runs.slice(0, count).map((run) => run.toISOString()) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid cron expression";
    return { ok: false, error: message, next: [] };
  } finally {
    job.stop();
  }
}

/** Next `count` runs strictly after `after`. Throws when the schedule is invalid. */
export function upcomingRuns(expression: string, timezone: string, after: Date, count: number): Date[] {
  const checked = checkSchedule(expression, timezone, after, count);
  if (!checked.ok) throw new Error(checked.error ?? "Invalid schedule");
  return checked.next.map((value) => new Date(value));
}

/** First slot strictly after `after`. Used when claiming a due routine. */
export function nextFutureSlot(routine: { cron: string; timezone: string }, after: Date): Date {
  const [next] = upcomingRuns(routine.cron, routine.timezone, after, 1);
  if (!next) throw new Error("Schedule has no upcoming run");
  return next;
}

export function normalizeCron(expression: string): string {
  return expression.trim().replace(/\s+/g, " ");
}

export function routineChatTitle(name: string, when: Date, timezone: string): string {
  const zone = timezone.trim() || "UTC";
  let formatted = when.toISOString();
  try {
    formatted = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .format(when)
      .replace(",", "");
  } catch {
    formatted = when.toISOString();
  }
  const title = `${name} · ${formatted} ${zone}`;
  return title.length <= 200 ? title : `${title.slice(0, 197)}...`;
}

function timezoneError(timezone: string): string | null {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return null;
  } catch {
    return `Unknown timezone ${JSON.stringify(timezone)}`;
  }
}

function collectRuns(job: Cron, after: Date, count: number): Date[] {
  const runs: Date[] = [];
  let cursor = after;
  for (let index = 0; index < count; index += 1) {
    const next = job.nextRun(cursor);
    if (!next) break;
    runs.push(next);
    cursor = next;
  }
  return runs;
}
