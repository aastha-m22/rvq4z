import { describe, expect, it } from "vitest";
import { addDays, energy, gwTicks, hours, power } from "./format";
import { merge } from "./components/ExplorerView";

describe("format", () => {
  it("formats power with sensible units", () => {
    expect(power(850)).toBe("850 MW");
    expect(power(1836)).toBe("1.84 GW");
    expect(power(12345)).toBe("12.3 GW");
    expect(power(1600, true)).toBe("+1.60 GW");
    expect(power(-400, true)).toBe("−400 MW");
    expect(power(null)).toBe("–");
  });
  it("formats energy and durations", () => {
    expect(energy(43210)).toBe("43.2 GWh");
    expect(hours(4.5)).toBe("4 h 30 min");
    expect(hours(16)).toBe("16 h");
  });
  it("builds round-number axis ticks that include zero", () => {
    expect(gwTicks(17805)).toEqual([0, 5000, 10000, 15000, 20000]);
    expect(gwTicks(1750, -400)).toEqual([-500, 0, 500, 1000, 1500, 2000]);
  });
  it("adds days across month ends", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
  });
});

describe("merge", () => {
  it("aligns half-hourly actuals with hourly forecasts", () => {
    const pts = merge({
      start: "", end: "", horizon_h: 4, metrics: { n: 0 },
      actuals: [
        { time: "2026-01-01T00:00:00Z", mw: 100 },
        { time: "2026-01-01T00:30:00Z", mw: 110 },
      ],
      forecasts: [{ time: "2026-01-01T00:00:00Z", mw: 120, publish_time: "2025-12-31T18:30:00Z", lead_h: 5.5 }],
    });
    expect(pts).toHaveLength(2);
    expect(pts[0]).toMatchObject({ actual: 100, forecast: 120, lead: 5.5 });
    expect(pts[1].forecast).toBeUndefined();
  });
});
