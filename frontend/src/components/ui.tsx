import { useEffect, useState, type ReactNode } from "react";

/** Resolved theme colours for Recharts (SVG attributes cannot read CSS variables). */
export interface Palette {
  actual: string;
  forecast: string;
  band: string;
  over: string;
  under: string;
  neutral: string;
  grid: string;
  text2: string;
  text3: string;
  surface: string;
}

function readPalette(): Palette {
  const s = getComputedStyle(document.documentElement);
  const v = (name: string) => s.getPropertyValue(name).trim();
  return {
    actual: v("--actual"),
    forecast: v("--forecast"),
    band: v("--band"),
    over: v("--over"),
    under: v("--under"),
    neutral: v("--neutral"),
    grid: v("--grid"),
    text2: v("--text-2"),
    text3: v("--text-3"),
    surface: v("--surface"),
  };
}

export function usePalette(): Palette {
  const [p, setP] = useState(readPalette);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setP(readPalette());
    mq.addEventListener("change", update);
    const obs = new MutationObserver(update);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => {
      mq.removeEventListener("change", update);
      obs.disconnect();
    };
  }, []);
  return p;
}

export function Tile({ label, value, sub, title }: { label: string; value: ReactNode; sub?: ReactNode; title?: string }) {
  return (
    <div className="tile" title={title}>
      <div className="label">{label}</div>
      <div className="value num">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

export function Card({
  title,
  desc,
  actions,
  children,
}: {
  title: string;
  desc?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>{title}</h2>
          {desc && <p className="desc">{desc}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function Legend({ items }: { items: { label: string; color: string; box?: boolean; dashed?: boolean }[] }) {
  return (
    <div className="legend" role="list">
      {items.map((it) => (
        <span key={it.label} role="listitem">
          <i
            className={it.box ? "box" : undefined}
            style={
              it.dashed
                ? { background: `repeating-linear-gradient(90deg, ${it.color} 0 4px, transparent 4px 7px)` }
                : { background: it.color }
            }
          />
          {it.label}
        </span>
      ))}
    </div>
  );
}

export function TooltipBox({ title, rows }: { title: string; rows: { label: string; value: string; color?: string }[] }) {
  return (
    <div className="tooltip">
      <div className="t">{title}</div>
      {rows.map((r) => (
        <div className="row" key={r.label}>
          <span>
            {r.color && <span className="sw" style={{ background: r.color }} />}
            {r.label}
          </span>
          <span className="num">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

export function Status({ loading, error, empty }: { loading?: boolean; error?: string; empty?: boolean }) {
  if (error) return <div className="state error">Could not load data. {error}</div>;
  if (loading) return <div className="state">Loading…</div>;
  if (empty) return <div className="state">No data for this selection.</div>;
  return null;
}
