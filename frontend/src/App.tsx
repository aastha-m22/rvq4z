import { useEffect, useState } from "react";
import { api, useApi } from "./api";
import AccuracyView from "./components/AccuracyView";
import DayAheadView from "./components/DayAheadView";
import ExplorerView, { type RangeState } from "./components/ExplorerView";

type TabId = "day-ahead" | "explorer" | "accuracy";

const TABS: { id: TabId; label: string; hint: string }[] = [
  { id: "day-ahead", label: "Day-ahead view", hint: "What was known at decision time" },
  { id: "explorer", label: "Forecast vs actual", hint: "Any period, any horizon" },
  { id: "accuracy", label: "Accuracy analysis", hint: "How far to trust it" },
];

function initialTab(): TabId {
  const h = window.location.hash.slice(1) as TabId;
  return TABS.some((t) => t.id === h) ? h : "day-ahead";
}

export default function App() {
  const [tab, setTab] = useState<TabId>(initialTab);
  // Range and horizon are shared by the explorer and accuracy tabs.
  const [range, setRange] = useState<RangeState>({ from: "2026-01-01", to: "2026-01-31", horizon: 4 });
  const meta = useApi(() => api.meta(), []);

  // Keep the tab in the URL so views can be linked to and survive a refresh.
  useEffect(() => {
    if (window.location.hash !== `#${tab}`) window.history.replaceState(null, "", `#${tab}`);
  }, [tab]);
  useEffect(() => {
    const onHash = () => setTab(initialTab());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return (
    <div className="shell">
      <header className="top">
        <div className="brand">
          <h1>Wind Forecast Monitor</h1>
          <p>Great Britain national wind generation · forecasts vs actuals · January 2026</p>
        </div>
        <div className="prov">
          Source: Elexon BMRS (FUELHH wind outturn, WINDFOR forecasts)
          <br />
          {meta.data ? (
            <span className="num">
              {meta.data.forecast_runs} forecast runs · {meta.data.actual_points.toLocaleString()} half-hours · runs at{" "}
              {meta.data.run_times_utc.join(", ")} UK
            </span>
          ) : meta.error ? (
            <span className="error">API unavailable</span>
          ) : (
            "Loading data…"
          )}
        </div>
      </header>

      <nav className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" className="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
            <small>{t.hint}</small>
          </button>
        ))}
      </nav>

      <main role="tabpanel">
        {tab === "day-ahead" && <DayAheadView />}
        {tab === "explorer" && <ExplorerView range={range} setRange={setRange} />}
        {tab === "accuracy" && <AccuracyView range={range} setRange={setRange} />}
      </main>

      <footer>
        All times UK local (GMT in January). Only forecasts published 0–48 h before delivery are used. Error = forecast −
        actual, so a positive error means the forecast promised more wind than arrived.
      </footer>
    </div>
  );
}
