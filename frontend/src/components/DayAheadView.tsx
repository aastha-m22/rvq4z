import { useMemo, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api, useApi } from "../api";
import { addDays, dayLong, energy, gwTick, gwTicks, hours, pct, power, time, toMs } from "../format";
import type { DayAheadResponse } from "../types";
import { Card, Legend, Status, Tile, TooltipBox, usePalette } from "./ui";

const FIRST = "2026-01-01";
const LAST = "2026-01-31";

export default function DayAheadView() {
  const [date, setDate] = useState("2026-01-15");
  const [decision, setDecision] = useState("09:00");
  const [showActual, setShowActual] = useState(true);
  const [showAdjusted, setShowAdjusted] = useState(false);
  const [showTable, setShowTable] = useState(false);
  const { data, error, loading } = useApi(() => api.dayAhead(date, decision), [date, decision]);
  const pal = usePalette();

  const rows = useMemo(
    () =>
      (data?.rows ?? []).map((r) => ({
        t: toMs(r.time),
        forecast: r.forecast_mw,
        actual: r.actual_mw,
        adjusted: r.median_adjusted_mw ?? null,
        band: r.low_mw != null && r.high_mw != null ? [r.low_mw, r.high_mw] : null,
        raw: r,
      })),
    [data],
  );

  const yTicks = gwTicks(
    Math.max(0, ...rows.flatMap((r) => [r.forecast ?? 0, r.actual ?? 0, r.band?.[1] ?? 0])),
  );

  const step = (n: number) => {
    const next = addDays(date, n);
    if (next >= FIRST && next <= LAST) setDate(next);
  };

  return (
    <>
      <div className="controls">
        <label className="field">
          <span>Delivery day</span>
          <input type="date" value={date} min={FIRST} max={LAST} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </label>
        <div className="field">
          <span>&nbsp;</span>
          <div className="seg">
            <button onClick={() => step(-1)} disabled={date <= FIRST} aria-label="Previous day">‹ Prev</button>
            <button onClick={() => step(1)} disabled={date >= LAST} aria-label="Next day">Next ›</button>
          </div>
        </div>
        <label className="field">
          <span>Decision time (day before, UK)</span>
          <input type="time" value={decision} step={1800} onChange={(e) => e.target.value && setDecision(e.target.value)} />
        </label>
        <div className="field">
          <span>Overlay</span>
          <div style={{ display: "flex", gap: 14, minHeight: 34, alignItems: "center" }}>
            <label className="check">
              <input type="checkbox" checked={showActual} onChange={(e) => setShowActual(e.target.checked)} />
              Actual (hindsight)
            </label>
            <label className="check">
              <input type="checkbox" checked={showAdjusted} onChange={(e) => setShowAdjusted(e.target.checked)} />
              Bias-adjusted forecast
            </label>
          </div>
        </div>
      </div>

      {data && <Headline data={data} />}
      {data && <DayTiles data={data} />}

      <Card
        title={`Wind generation for ${dayLong(`${date}T12:00:00Z`)}`}
        desc="The forecast a trader would have seen at decision time, with an 80% range calibrated only on errors known by then (previous 28 days, similar lead time)."
        actions={
          <button className="linkbtn" onClick={() => setShowTable((v) => !v)}>
            {showTable ? "Show chart" : "Show table"}
          </button>
        }
      >
        <Legend
          items={[
            { label: "Forecast at decision time", color: pal.forecast },
            { label: "80% likely range", color: pal.band, box: true },
            ...(showAdjusted ? [{ label: "Bias-adjusted forecast", color: pal.text2, dashed: true }] : []),
            ...(showActual ? [{ label: "Actual (known after delivery)", color: pal.actual }] : []),
          ]}
        />
        <Status loading={loading && !data} error={error} empty={!!data && rows.every((r) => r.forecast == null)} />
        {data && !showTable && (
          <div className={`chart-wrap ${loading ? "loading" : ""}`} style={{ height: 360 }}>
            <ResponsiveContainer>
              <ComposedChart data={rows} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
                <CartesianGrid stroke={pal.grid} vertical={false} />
                <XAxis
                  dataKey="t"
                  type="number"
                  scale="time"
                  domain={["dataMin", "dataMax"]}
                  tickFormatter={time}
                  ticks={rows.filter((_, i) => i % 3 === 0).map((r) => r.t)}
                  stroke={pal.text3}
                  tick={{ fontSize: 12 }}
                />
                <YAxis
                  tickFormatter={gwTick}
                  stroke={pal.text3}
                  tick={{ fontSize: 12 }}
                  width={44}
                  label={{ value: "GW", angle: -90, position: "insideLeft", fill: pal.text3, fontSize: 12 }}
                  domain={[0, yTicks.at(-1)!]}
                  ticks={yTicks}
                />
                <Tooltip content={<DayTooltip pal={pal} />} />
                <Area dataKey="band" stroke="none" fill={pal.band} fillOpacity={1} isAnimationActive={false} connectNulls />
                <Line dataKey="forecast" stroke={pal.forecast} strokeWidth={2} dot={false} isAnimationActive={false} />
                {showAdjusted && (
                  <Line dataKey="adjusted" stroke={pal.text2} strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
                )}
                {showActual && (
                  <Line dataKey="actual" stroke={pal.actual} strokeWidth={2} dot={false} isAnimationActive={false} />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
        {data && showTable && <DayTable data={data} />}
      </Card>
    </>
  );
}

function Headline({ data }: { data: DayAheadResponse }) {
  const run = data.forecast_runs_used.at(-1);
  if (!run) return <div className="callout">No forecast covering this day had been published by the decision time.</div>;
  const gap = (toMs(data.decision_at) - toMs(run)) / 3.6e6;
  const fc = data.rows.map((r) => r.forecast_mw).filter((v): v is number => v != null);
  const leads = data.rows.map((r) => r.lead_h).filter((v): v is number => v != null);
  return (
    <div className="callout" style={{ background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)" }}>
      At <b>{time(data.decision_at)} on {dayLong(data.decision_at)}</b>, the latest wind forecast was the{" "}
      <b>{time(run)} run</b> ({hours(gap)} old), looking {hours(Math.min(...leads))}–{hours(Math.max(...leads))} ahead. It
      expected <b>{energy(data.energy.forecast_mwh)}</b> of wind across the day, between{" "}
      <b>{power(Math.min(...fc))}</b> and <b>{power(Math.max(...fc))}</b>.
    </div>
  );
}

function DayTiles({ data }: { data: DayAheadResponse }) {
  const { energy: e, metrics: m } = data;
  const short = e.shortfall_mwh;
  return (
    <div className="tiles">
      <Tile label="Forecast energy" value={energy(e.forecast_mwh)} sub={`${e.hours} delivery hours`} />
      <Tile label="Actual energy (hindsight)" value={energy(e.actual_mwh)} />
      <Tile
        label={short >= 0 ? "Wind shortfall vs forecast" : "Wind surplus vs forecast"}
        value={energy(Math.abs(short))}
        sub={short >= 0 ? "Extra power to buy after the auction" : "Purchased power not needed"}
        title="Forecast energy minus actual energy over the matched hours"
      />
      <Tile label="Mean absolute error" value={power(m.mae_mw)} sub={`Bias ${power(m.bias_mw, true)}`} />
      <Tile
        label="Actual inside 80% range"
        value={pct(data.band_coverage_pct)}
        sub={data.band_coverage_pct == null ? "Not enough history yet" : "Target ≈ 80%"}
      />
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function DayTooltip({ active, payload, pal }: any) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload.raw as DayAheadResponse["rows"][number];
  const err = r.forecast_mw != null && r.actual_mw != null ? r.forecast_mw - r.actual_mw : null;
  return (
    <TooltipBox
      title={`${dayLong(r.time)}, ${time(r.time)}`}
      rows={[
        { label: "Forecast", value: power(r.forecast_mw), color: pal.forecast },
        ...(r.low_mw != null ? [{ label: "80% range", value: `${power(r.low_mw)} – ${power(r.high_mw)}` }] : []),
        { label: "Actual", value: power(r.actual_mw), color: pal.actual },
        { label: "Error (fc − act)", value: power(err, true) },
        ...(r.publish_time ? [{ label: "Run / lead", value: `${time(r.publish_time)} · ${hours(r.lead_h ?? 0)}` }] : []),
      ]}
    />
  );
}

function DayTable({ data }: { data: DayAheadResponse }) {
  return (
    <div className="table-scroll">
      <table className="data num">
        <thead>
          <tr>
            <th>Hour</th>
            <th>Forecast</th>
            <th>Low (P10)</th>
            <th>High (P90)</th>
            <th>Actual</th>
            <th>Error</th>
            <th>Lead</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={r.time}>
              <td>{time(r.time)}</td>
              <td>{power(r.forecast_mw)}</td>
              <td>{power(r.low_mw)}</td>
              <td>{power(r.high_mw)}</td>
              <td>{power(r.actual_mw)}</td>
              <td>{r.forecast_mw != null && r.actual_mw != null ? power(r.forecast_mw - r.actual_mw, true) : "–"}</td>
              <td>{r.lead_h != null ? hours(r.lead_h) : "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
