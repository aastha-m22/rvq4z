import { useMemo } from "react";
import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, useApi } from "../api";
import { addDays, day, dayStartIso, dayTime, gwTick, gwTicks, hours, pct, power, toMs } from "../format";
import type { TimeseriesResponse } from "../types";
import { Card, Legend, Status, Tile, TooltipBox, usePalette, type Palette } from "./ui";

const PRESETS: { label: string; from: string; to: string }[] = [
  { label: "Full month", from: "2026-01-01", to: "2026-01-31" },
  { label: "Week 1", from: "2026-01-01", to: "2026-01-07" },
  { label: "Week 2", from: "2026-01-08", to: "2026-01-14" },
  { label: "Week 3", from: "2026-01-15", to: "2026-01-21" },
  { label: "Week 4+", from: "2026-01-22", to: "2026-01-31" },
];

export interface RangeState {
  from: string; // yyyy-mm-dd, inclusive
  to: string; // yyyy-mm-dd, inclusive
  horizon: number;
}

export function RangeControls({ value, onChange }: { value: RangeState; onChange: (v: RangeState) => void }) {
  const set = (patch: Partial<RangeState>) => onChange({ ...value, ...patch });
  return (
    <div className="controls">
      <label className="field">
        <span>From</span>
        <input
          type="date"
          min="2026-01-01"
          max={value.to}
          value={value.from}
          onChange={(e) => e.target.value && set({ from: e.target.value })}
        />
      </label>
      <label className="field">
        <span>To</span>
        <input
          type="date"
          min={value.from}
          max="2026-01-31"
          value={value.to}
          onChange={(e) => e.target.value && set({ to: e.target.value })}
        />
      </label>
      <div className="field">
        <span>Quick range</span>
        <div className="seg">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              aria-pressed={value.from === p.from && value.to === p.to}
              onClick={() => set({ from: p.from, to: p.to })}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <label className="field">
        <span>
          Forecast horizon: <b className="num">{value.horizon} h</b> before delivery
        </span>
        <input
          type="range"
          min={0}
          max={47}
          step={1}
          value={value.horizon}
          onChange={(e) => set({ horizon: Number(e.target.value) })}
          aria-describedby="horizon-help"
        />
      </label>
      <small id="horizon-help" style={{ color: "var(--text-3)", flexBasis: "100%", marginTop: -6 }}>
        For each hour we show the latest forecast published at least {value.horizon} h earlier, i.e. what you would
        have known that far ahead. Day-ahead purchases typically use 15–40 h horizons.
      </small>
    </div>
  );
}

export default function ExplorerView({ range, setRange }: { range: RangeState; setRange: (r: RangeState) => void }) {
  const start = dayStartIso(range.from);
  const end = dayStartIso(addDays(range.to, 1));
  const { data, error, loading } = useApi(
    () => api.timeseries(start, end, range.horizon),
    [start, end, range.horizon],
  );
  const pal = usePalette();
  const merged = useMemo(() => (data ? merge(data) : []), [data]);
  const m = data?.metrics;
  const spanDays = (toMs(end) - toMs(start)) / 864e5;
  const yTicks = gwTicks(Math.max(0, ...merged.map((p) => Math.max(p.actual ?? 0, p.forecast ?? 0))));

  return (
    <>
      <RangeControls value={range} onChange={setRange} />
      {m && m.n > 0 && (
        <div className="tiles">
          <Tile label="Mean absolute error" value={power(m.mae_mw)} sub={`${pct(m.nmae_pct, 1)} of mean output`} />
          <Tile label="RMSE" value={power(m.rmse_mw)} sub="Penalises large misses" />
          <Tile
            label="Bias (forecast − actual)"
            value={power(m.bias_mw, true)}
            sub={`Too high in ${pct(m.over_forecast_pct)} of hours`}
          />
          <Tile label="90th percentile miss" value={power(m.p90_abs_error_mw)} sub={`Worst: ${power(m.max_abs_error_mw)}`} />
          <Tile label="Hours within ±1 GW" value={pct(m.within_1gw_pct)} sub={`${m.n} hours compared`} />
        </div>
      )}
      <Card
        title="Forecast vs actual national wind generation"
        desc={`Actual output every 30 minutes; forecast hourly, as known ${range.horizon} h before each hour.`}
      >
        <Legend
          items={[
            { label: "Actual", color: pal.actual },
            { label: `Forecast (${range.horizon} h ahead)`, color: pal.forecast },
          ]}
        />
        <Status loading={loading && !data} error={error} empty={!!data && !data.actuals.length} />
        {data && (
          <div className={`chart-wrap ${loading ? "loading" : ""}`} style={{ height: 380 }}>
            <ResponsiveContainer>
              <ComposedChart data={merged} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
                <CartesianGrid stroke={pal.grid} vertical={false} />
                <XAxis
                  dataKey="t"
                  type="number"
                  scale="time"
                  domain={[toMs(start), toMs(end)]}
                  tickFormatter={spanDays > 3 ? day : dayTime}
                  stroke={pal.text3}
                  tick={{ fontSize: 12 }}
                  minTickGap={28}
                />
                <YAxis
                  tickFormatter={gwTick}
                  stroke={pal.text3}
                  tick={{ fontSize: 12 }}
                  width={44}
                  domain={[0, yTicks.at(-1)!]}
                  ticks={yTicks}
                  label={{ value: "GW", angle: -90, position: "insideLeft", fill: pal.text3, fontSize: 12 }}
                />
                <Tooltip content={<SeriesTooltip pal={pal} />} />
                <Line dataKey="actual" stroke={pal.actual} strokeWidth={spanDays > 10 ? 1.5 : 2} dot={false} isAnimationActive={false} connectNulls />
                <Line dataKey="forecast" stroke={pal.forecast} strokeWidth={spanDays > 10 ? 1.5 : 2} dot={false} isAnimationActive={false} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>
    </>
  );
}

interface Point {
  t: number;
  actual?: number;
  forecast?: number;
  publish?: string;
  lead?: number;
}

/** Put half-hourly actuals and hourly forecasts on one time axis. */
export function merge(data: TimeseriesResponse): Point[] {
  const byT = new Map<number, Point>();
  for (const a of data.actuals) byT.set(toMs(a.time), { t: toMs(a.time), actual: a.mw });
  for (const f of data.forecasts) {
    const t = toMs(f.time);
    byT.set(t, { ...(byT.get(t) ?? { t }), forecast: f.mw, publish: f.publish_time, lead: f.lead_h });
  }
  return [...byT.values()].sort((a, b) => a.t - b.t);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function SeriesTooltip({ active, payload, pal }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload as Point;
  const err = p.forecast != null && p.actual != null ? p.forecast - p.actual : null;
  const rows = [
    { label: "Actual", value: power(p.actual), color: (pal as Palette).actual },
    ...(p.forecast != null
      ? [
          { label: "Forecast", value: power(p.forecast), color: (pal as Palette).forecast },
          { label: "Error (fc − act)", value: power(err, true) },
          { label: "Run / lead", value: `${dayTime(p.publish!)} · ${hours(p.lead!)}` },
        ]
      : []),
  ];
  return <TooltipBox title={`${dayTime(p.t)}`} rows={rows} />;
}

