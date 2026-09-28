import { describe, expect, test } from "bun:test";
import { describeCron } from "./schedule";

describe("describeCron", () => {
  test("humanizes common patterns and leaves the rest raw", () => {
    expect(describeCron("* * * * *")).toBe("Every minute");
    expect(describeCron("*/1 * * * *")).toBe("Every minute");
    expect(describeCron("*/15 * * * *")).toBe("Every 15 minutes");
    expect(describeCron("0 * * * *")).toBe("Hourly at :00");
    expect(describeCron("30 * * * *")).toBe("Hourly at :30");
    expect(describeCron("0 7 * * *")).toBe("Daily at 07:00");
    expect(describeCron("5 9 * * *")).toBe("Daily at 09:05");
    expect(describeCron("0 9 * * 1-5")).toBe("Weekdays at 09:00");
    expect(describeCron("0 9 * * 1")).toBe("On Monday at 09:00");
    expect(describeCron("15 18 * * 1,3,5")).toBe("On Monday, Wednesday, Friday at 18:15");
    expect(describeCron("0 8 1 * *")).toBe("Monthly on day 1 at 08:00");
    expect(describeCron("0 9 * * 0")).toBe("On Sunday at 09:00");
    expect(describeCron("0 9 1 * 1")).toBe("0 9 1 * 1");
    expect(describeCron("0 9 * 1 *")).toBe("0 9 * 1 *");
  });
});