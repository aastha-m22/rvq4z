// Formatting helpers. All display times are UK local (Europe/London).
// In January that equals UTC, but formatting through the zone keeps it correct
// if the window ever moves into British Summer Time.

const TZ = "Europe/London";

const dtf = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, ...opts });
const fmtTime = dtf({ hour: "2-digit", minute: "2-digit", hour12: false });
const fmtDay = dtf({ day: "numeric", month: "short" });
const fmtDayLong = dtf({ weekday: "short", day: "numeric", month: "short" });

export const toMs = (iso: string) => Date.parse(iso);
export const time = (v: string | number) => fmtTime.format(new Date(v));
export const day = (v: string | number) => fmtDay.format(new Date(v));
export const dayLong = (v: string | number) => fmtDayLong.format(new Date(v));
export const dayTime = (v: string | number) => `${day(v)} ${time(v)}`;

/** MW value to a compact string: 12345 -> "12.3 GW", 850 -> "850 MW". */
export function power(mw: number | null | undefined, signed = false): string {
  if (mw == null || Number.isNaN(mw)) return "–";
  const sign = signed && mw > 0 ? "+" : mw < 0 ? "−" : "";
  const a = Math.abs(mw);
  return a >= 1000 ? `${sign}${(a / 1000).toFixed(a >= 10000 ? 1 : 2)} GW` : `${sign}${Math.round(a)} MW`;
}

export function energy(mwh: number | null | undefined, signed = false): string {
  if (mwh == null || Number.isNaN(mwh)) return "–";
  const sign = signed && mwh > 0 ? "+" : mwh < 0 ? "−" : "";
  const a = Math.abs(mwh);
  return a >= 1000 ? `${sign}${(a / 1000).toFixed(1)} GWh` : `${sign}${Math.round(a)} MWh`;
}

export const pct = (v: number | null | undefined, digits = 0) =>
  v == null || Number.isNaN(v) ? "–" : `${v.toFixed(digits)}%`;

export function gwTick(mw: number): string {
  const g = mw / 1000;
  return Number.isInteger(Math.round(g * 10) / 10) ? String(Math.round(g)) : g.toFixed(1);
}

/** Round-number MW ticks spanning [minMw, maxMw] and always including 0 (≤ ~6 steps). */
export function gwTicks(maxMw: number, minMw = 0): number[] {
  const lo = Math.min(0, minMw);
  const hi = Math.max(0, maxMw);
  const span = Math.max(hi - lo, 1);
  const step = [250, 500, 1000, 2000, 2500, 5000, 10000].find((s) => span / s <= 6) ?? 10000;
  const from = Math.floor(lo / step) * step;
  const to = Math.max(from + step, Math.ceil(hi / step) * step);
  return Array.from({ length: Math.round((to - from) / step) + 1 }, (_, i) => from + i * step);
}

export function hours(h: number): string {
  const whole = Math.floor(h);
  const mins = Math.round((h - whole) * 60);
  return mins ? `${whole} h ${mins} min` : `${whole} h`;
}

/** UTC ISO string for 00:00 UK on a yyyy-mm-dd date (January: == UTC midnight). */
export const dayStartIso = (d: string) => `${d}T00:00:00Z`;

export function addDays(d: string, n: number): string {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
