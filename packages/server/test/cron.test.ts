import { describe, expect, test } from "bun:test";

import { checkSchedule, nextFutureSlot, routineChatTitle, upcomingRuns } from "../src/routines/cron.ts";

describe("cron schedules", () => {
  test("accepts a 5-field expression and previews the next runs", () => {
    const checked = checkSchedule("0 9 * * *", "UTC", new Date("2026-01-01T00:00:00.000Z"), 5);
    expect(checked.ok).toBe(true);
    expect(checked.next).toEqual([
      "2026-01-01T09:00:00.000Z",
      "2026-01-02T09:00:00.000Z",
      "2026-01-03T09:00:00.000Z",
      "2026-01-04T09:00:00.000Z",
      "2026-01-05T09:00:00.000Z",
    ]);
  });

  test("allows once a minute and rejects anything faster", () => {
    expect(checkSchedule("* * * * *", "UTC", new Date("2026-01-01T00:00:30.000Z")).ok).toBe(true);
    expect(checkSchedule("*/1 * * * *", "UTC").ok).toBe(true);
    const seconds = checkSchedule("* * * * * *", "UTC");
    expect(seconds.ok).toBe(false);
    expect(seconds.error).toMatch(/once a minute/i);
  });

  test("labels listener chat times in UTC", () => {
    const title = routineChatTitle("Test hook", new Date("2026-09-28T07:59:00.000Z"), "UTC");
    expect(title).toBe("Test hook · 28 Sept 2026 07:59 UTC");
  });

  test("rejects an unknown timezone", () => {
    const checked = checkSchedule("0 9 * * *", "Not/AZone");
    expect(checked.ok).toBe(false);
    expect(checked.error).toMatch(/timezone/i);
  });

  test("keeps 09:00 local across US daylight-saving transitions", () => {
    const spring = upcomingRuns("0 9 * * *", "America/New_York", new Date("2026-03-07T14:00:00.000Z"), 1);
    expect(spring[0]?.toISOString()).toBe("2026-03-08T13:00:00.000Z");
    const fall = upcomingRuns("0 9 * * *", "America/New_York", new Date("2026-10-31T13:00:00.000Z"), 1);
    expect(fall[0]?.toISOString()).toBe("2026-11-01T14:00:00.000Z");
  });

  test("next slot is strictly after the given instant", () => {
    const next = nextFutureSlot(
      { cron: "0 * * * *", timezone: "UTC" },
      new Date("2026-06-15T12:00:00.000Z"),
    );
    expect(next.toISOString()).toBe("2026-06-15T13:00:00.000Z");
  });
});
