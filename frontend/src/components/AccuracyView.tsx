import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api, useApi } from "../api";
import { addDays, dayStartIso, gwTick, gwTicks, pct, power } from "../format";
import type { AccuracyResponse, HorizonRow } from "../types";
import { RangeControls, type RangeState } from "./ExplorerView";
import { Card, Legend, Status, TooltipBox, usePalette, type Palette } from "./ui";

export default function AccuracyView({ range, setRange }: { range: RangeState; setRange: (r: RangeState) => void }) {
  const start = dayStartIso(range.from);
  const end = dayStartIso(addDays(range.to, 1));
  const prof = useApi(() => api.horizonProfile(start, end, 1), [start, end]);
  const acc = useApi(() => api.accuracy(start, end, range.horizon), [start, end, range.horizon]);
  const pal = usePalette();

  return (
    <>
      <RangeControls value={range} onChange={setRange} />
      {prof.data && acc.data && <Insights profile={prof.data.rows} acc={acc.data} />}

      <Card
        title="How accuracy changes with forecast horizon"
        desc="Every forecast run in the selected period, grouped by how far ahead it was made. The shaded band holds the middle 80% of errors; the highlighted window is where day-ahead purchase decisions sit."
      >
        <Legend
          items={[
            { label: "Mean absolute error", color: pal.actual },
            { label: "Bias (mean forecast − actual)", color: pal.forecast },
            { label: "MAE with bias removed", color: pal.text2, dashed: true },
            { label: "P10–P90 error range", color: pal.band, box: true },
          ]}
        />
        <Status loading={prof.loading && !prof.data} error={prof.error} empty={!!prof.data && !prof.data.rows.length} />
        {prof.data && (
          <div style={{ height: 340 }}>
            <ResponsiveContainer>
              <ComposedChart
                data={prof.data.rows.map((r) => ({ ...r, x: r.lead_from_h + 0.5, range: [r.error_p10_mw, r.error_p90_mw] }))}
                margin={{ top: 22, right: 12, bottom: 18, left: 0 }}
              >
                <CartesianGrid stroke={pal.grid} vertical={false} />
                <ReferenceArea x1={15} x2={40} fill={pal.neutral} fillOpacity={0.12} />
                <ReferenceLine y={0} stroke={pal.text3} />
                <ReferenceLine
                  x={range.horizon + 0.5}
                  stroke={pal.text3}
                  strokeDasharray="3 3"
                  label={{ value: `${range.horizon} h`, position: "top", fill: pal.text2, fontSize: 11 }}
                />
                <XAxis
                  dataKey="x"
                  type="number"
                  domain={[0, 48]}
                  ticks={[0, 6, 12, 18, 24, 30, 36, 42, 48]}
                  stroke={pal.text3}
                  tick={{ fontSize: 12 }}
                  label={{ value: "Hours between forecast publication and delivery", position: "insideBottom", offset: -10, fill: pal.text3, fontSize: 12 }}
                />
                <YAxis tickFormatter={gwTick} stroke={pal.text3} tick={{ fontSize: 12 }} width={44}
                  {...ticksFor(prof.data.rows.flatMap((r) => [r.error_p10_mw, r.error_p90_mw, r.mae_mw, r.bias_mw]))}
                  label={{ value: "GW", angle: -90, position: "insideLeft", fill: pal.text3, fontSize: 12 }} />
                <Tooltip content={<ProfileTooltip pal={pal} />} />
                <Area dataKey="range" stroke="none" fill={pal.band} fillOpacity={1} isAnimationActive={false} />
                <Line dataKey="mae_mw" stroke={pal.actual} strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line dataKey="bias_mw" stroke={pal.forecast} strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line dataKey="mae_debiased_mw" stroke={pal.text2} strokeDasharray="5 4" strokeWidth={2} dot={false} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <Status loading={acc.loading && !acc.data} error={acc.error} />
      {acc.data && (
        <div className="grid2">
          <Card title="Distribution of errors" desc={`Forecast − actual at ${range.horizon} h ahead. Right of zero = forecast too high (utility under-buys).`}>
            <Legend items={[{ label: "Over-forecast", color: pal.over, box: true }, { label: "Under-forecast", color: pal.under, box: true }]} />
            <div style={{ height: 260 }}>
              <ResponsiveContainer>
                <BarChart data={acc.data.histogram.map((h) => ({ ...h, mid: h.from_mw + (h.to_mw - h.from_mw) / 2 }))} barCategoryGap={1}>
                  <CartesianGrid stroke={pal.grid} vertical={false} />
                  <XAxis dataKey="mid" tickFormatter={(v: number) => (v / 1000).toFixed(1)} stroke={pal.text3} tick={{ fontSize: 12 }}
                    label={{ value: "Error (GW)", position: "insideBottom", offset: -2, fill: pal.text3, fontSize: 12 }} height={36} />
                  <YAxis stroke={pal.text3} tick={{ fontSize: 12 }} width={36} allowDecimals={false} />
                  <Tooltip cursor={{ fill: pal.grid }} content={<HistTooltip />} />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                    {acc.data.histogram.map((h) => (
                      <Cell key={h.from_mw} fill={h.from_mw >= 0 ? pal.over : pal.under} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card title="Bias by time of day" desc="Average forecast − actual for each UK hour. Consistent colour = a pattern worth correcting for.">
            <div style={{ height: 286 }}>
              <ResponsiveContainer>
                <BarChart data={acc.data.by_hour} barCategoryGap={2}>
                  <CartesianGrid stroke={pal.grid} vertical={false} />
                  <XAxis dataKey="hour" tickFormatter={(h: number) => `${String(h).padStart(2, "0")}`} stroke={pal.text3} tick={{ fontSize: 12 }} interval={2} />
                  <YAxis tickFormatter={gwTick} stroke={pal.text3} tick={{ fontSize: 12 }} width={36}
                    {...ticksFor(acc.data.by_hour.map((h) => h.bias_mw ?? 0))} />
                  <ReferenceLine y={0} stroke={pal.text3} />
                  <Tooltip cursor={{ fill: pal.grid }} content={<SummaryTooltip label={(r: { hour: number }) => `${String(r.hour).padStart(2, "0")}:00`} />} />
                  <Bar dataKey="bias_mw" radius={4} isAnimationActive={false}>
                    {acc.data.by_hour.map((h) => (
                      <Cell key={h.hour} fill={(h.bias_mw ?? 0) >= 0 ? pal.over : pal.under} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card title="Error by actual output level" desc="Where in the output range the forecast struggles most (mean absolute error and bias).">
            <Legend items={[{ label: "Mean absolute error", color: pal.actual, box: true }, { label: "Bias", color: pal.forecast, box: true }]} />
            <div style={{ height: 260 }}>
              <ResponsiveContainer>
                <BarChart data={acc.data.by_level.map((l) => ({ ...l, name: l.to_mw == null ? `${l.from_mw / 1000}+ GW` : `${l.from_mw / 1000}–${l.to_mw / 1000} GW` }))} barGap={2}>
                  <CartesianGrid stroke={pal.grid} vertical={false} />
                  <XAxis dataKey="name" stroke={pal.text3} tick={{ fontSize: 12 }} />
                  <YAxis tickFormatter={gwTick} stroke={pal.text3} tick={{ fontSize: 12 }} width={36}
                    {...ticksFor(acc.data.by_level.flatMap((l) => [l.mae_mw ?? 0, l.bias_mw ?? 0]))} />
                  <ReferenceLine y={0} stroke={pal.text3} />
                  <Tooltip cursor={{ fill: pal.grid }} content={<SummaryTooltip label={(r: { name: string }) => `Actual ${r.name}`} />} />
                  <Bar dataKey="mae_mw" fill={pal.actual} radius={4} isAnimationActive={false} />
                  <Bar dataKey="bias_mw" fill={pal.forecast} radius={4} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card title={`Summary at ${range.horizon} h ahead`} desc="All metrics in MW; error = forecast − actual.">
            <MetricsTable acc={acc.data} />
          </Card>
        </div>
      )}
    </>
  );
}

/** Round-number GW ticks and a matching domain for a set of MW values. */
function ticksFor(values: number[]) {
  const ticks = gwTicks(Math.max(0, ...values), Math.min(0, ...values));
  return { ticks, domain: [ticks[0], ticks.at(-1)!] as [number, number] };
}

function Insights({ profile, acc }: { profile: HorizonRow[]; acc: AccuracyResponse }) {
  const m = acc.metrics;
  if (!m.n || !profile.length) return null;
  const near = profile.find((r) => r.lead_from_h === 4);
  const da = profile.filter((r) => r.lead_from_h >= 15 && r.lead_from_h < 40);
  const daMae = da.length ? da.reduce((s, r) => s + r.mae_mw * r.n, 0) / da.reduce((s, r) => s + r.n, 0) : null;
  const daBias = da.length ? da.reduce((s, r) => s + r.bias_mw * r.n, 0) / da.reduce((s, r) => s + r.n, 0) : null;
  const biasShare = m.bias_mw && m.mae_mw ? Math.abs(m.bias_mw) / m.mae_mw : 0;
  return (
    <div className="callout">
      <b>What the numbers say for this period</b>
      <ul className="insights">
        <li>
          At {acc.horizon_h} h ahead the forecast misses by <b>{power(m.mae_mw)}</b> on average ({pct(m.nmae_pct, 1)} of mean
          output){near && acc.horizon_h !== 4 ? `; at 4 h it is ${power(near.mae_mw)}` : ""}.
        </li>
        {daMae != null && (
          <li>
            In the day-ahead window (15–40 h) the average miss is <b>{power(daMae)}</b> with a bias of{" "}
            <b>{power(daBias, true)}</b>.
          </li>
        )}
        {biasShare > 0.5 && (
          <li>
            Most of the error is a <b>systematic {m.bias_mw! > 0 ? "over" : "under"}-forecast</b>: the forecast was too{" "}
            {m.bias_mw! > 0 ? "high" : "low"} in {pct(m.bias_mw! > 0 ? m.over_forecast_pct : 100 - (m.over_forecast_pct ?? 0))}{" "}
            of hours. Removing the average bias would cut the mean miss from {power(m.mae_mw)} to{" "}
            <b>{power(m.mae_debiased_mw)}</b>.
          </li>
        )}
      </ul>
    </div>
  );
}

function MetricsTable({ acc }: { acc: AccuracyResponse }) {
  const m = acc.metrics;
  const rows: [string, string][] = [
    ["Hours compared", String(m.n)],
    ["Mean absolute error (MAE)", power(m.mae_mw)],
    ["Root mean squared error", power(m.rmse_mw)],
    ["Bias (mean error)", power(m.bias_mw, true)],
    ["MAE with bias removed", power(m.mae_debiased_mw)],
    ["MAE as % of mean output", pct(m.nmae_pct, 1)],
    ["Median absolute error", power(m.p50_abs_error_mw)],
    ["90th / 99th percentile miss", `${power(m.p90_abs_error_mw)} / ${power(m.p99_abs_error_mw)}`],
    ["Largest miss", power(m.max_abs_error_mw)],
    ["Hours over-forecast", pct(m.over_forecast_pct)],
    ["Correlation with actual", m.correlation != null ? m.correlation.toFixed(3) : "–"],
  ];
  return (
    <table className="data num">
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k}>
            <td style={{ fontFamily: "var(--sans)" }}>{k}</td>
            <td>{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ProfileTooltip({ active, payload, pal }: any) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload as HorizonRow;
  const p = pal as Palette;
  return (
    <TooltipBox
      title={`${r.lead_from_h}–${r.lead_to_h} h ahead`}
      rows={[
        { label: "MAE", value: power(r.mae_mw), color: p.actual },
        { label: "Bias", value: power(r.bias_mw, true), color: p.forecast },
        { label: "MAE, bias removed", value: power(r.mae_debiased_mw) },
        { label: "P10 / P90 error", value: `${power(r.error_p10_mw, true)} / ${power(r.error_p90_mw, true)}` },
        { label: "Forecasts", value: String(r.n) },
      ]}
    />
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function HistTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const h = payload[0].payload;
  return <TooltipBox title={`Error ${power(h.from_mw, true)} to ${power(h.to_mw, true)}`} rows={[{ label: "Hours", value: String(h.count) }]} />;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function SummaryTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  return (
    <TooltipBox
      title={label(r)}
      rows={[
        { label: "MAE", value: power(r.mae_mw) },
        { label: "Bias", value: power(r.bias_mw, true) },
        { label: "Hours", value: String(r.n) },
      ]}
    />
  );
}
