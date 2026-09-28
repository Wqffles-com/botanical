export const CRON_PRESETS = [
  { id: "minute", label: "Every minute", cron: "* * * * *" },
  { id: "hourly", label: "Hourly", cron: "0 * * * *" },
  { id: "daily", label: "Daily at 09:00", cron: "0 9 * * *" },
  { id: "weekdays", label: "Weekdays at 09:00", cron: "0 9 * * 1-5" },
  { id: "weekly", label: "Mondays at 09:00", cron: "0 9 * * 1" },
  { id: "custom", label: "Custom", cron: "" },
] as const;

export type CronPresetId = (typeof CRON_PRESETS)[number]["id"];

export function presetForCron(cron: string): CronPresetId {
  const match = CRON_PRESETS.find((preset) => preset.id !== "custom" && preset.cron === cron.trim());
  return match?.id ?? "custom";
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/** A short phrase for common 5-field expressions. Anything else is returned unchanged. */
export function describeCron(cron: string): string {
  const text = cron.trim().replace(/\s+/g, " ");
  const fields = text.split(" ");
  if (fields.length !== 5) return text;
  const [minute, hour, day, month, weekday] = fields as [string, string, string, string, string];
  if (month !== "*") return text;

  if (minute === "*" && hour === "*" && day === "*" && weekday === "*") return "Every minute";
  const step = minute.startsWith("*/") ? Number(minute.slice(2)) : Number.NaN;
  if (minute.startsWith("*/") && hour === "*" && day === "*" && weekday === "*" && Number.isInteger(step)) {
    if (step === 1) return "Every minute";
    if (step > 1 && step < 60) return `Every ${step} minutes`;
  }
  if (isMinute(minute) && hour === "*" && day === "*" && weekday === "*") {
    return `Hourly at :${pad(minute)}`;
  }
  if (isMinute(minute) && isHour(hour) && day === "*" && weekday === "*") {
    return `Daily at ${pad(hour)}:${pad(minute)}`;
  }
  if (isMinute(minute) && isHour(hour) && isMonthDay(day) && weekday === "*") {
    return `Monthly on day ${Number(day)} at ${pad(hour)}:${pad(minute)}`;
  }
  if (isMinute(minute) && isHour(hour) && day === "*") {
    const days = weekdays(weekday);
    if (!days) return text;
    const clock = `${pad(hour)}:${pad(minute)}`;
    if (days.length === 5 && days.every((dayNumber, index) => dayNumber === index + 1)) {
      return `Weekdays at ${clock}`;
    }
    return `On ${days.map((dayNumber) => WEEKDAYS[dayNumber]).join(", ")} at ${clock}`;
  }
  return text;
}

function isMinute(value: string): boolean {
  return /^\d{1,2}$/.test(value) && Number(value) >= 0 && Number(value) <= 59;
}

function isHour(value: string): boolean {
  return /^\d{1,2}$/.test(value) && Number(value) >= 0 && Number(value) <= 23;
}

function isMonthDay(value: string): boolean {
  return /^\d{1,2}$/.test(value) && Number(value) >= 1 && Number(value) <= 31;
}

function pad(value: string): string {
  return String(Number(value)).padStart(2, "0");
}

function weekdays(field: string): number[] | null {
  if (field === "*" || field === "") return null;
  const days = new Set<number>();
  for (const part of field.split(",")) {
    const range = /^(\d{1,2})(?:-(\d{1,2}))?$/.exec(part);
    if (!range) return null;
    const start = normalizeWeekday(Number(range[1]));
    const end = range[2] === undefined ? start : normalizeWeekday(Number(range[2]));
    if (start === null || end === null) return null;
    if (range[2] === undefined) {
      days.add(start);
      continue;
    }
    if (start > end) return null;
    for (let day = start; day <= end; day += 1) days.add(day);
  }
  if (days.size === 0) return null;
  return [...days].sort((a, b) => a - b);
}

function normalizeWeekday(value: number): number | null {
  if (value === 7) return 0;
  if (value >= 0 && value <= 6) return value;
  return null;
}

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function timeZones(): string[] {
  const fallback = ["UTC"];
  try {
    const supported = Intl.supportedValuesOf("timeZone");
    return supported.includes("UTC") ? supported : ["UTC", ...supported];
  } catch {
    return fallback;
  }
}

export function formatWhen(value: string | null | undefined, timeZone?: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
      ...(timeZone ? { timeZone } : {}),
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
}
