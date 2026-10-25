// Response shapes of the FastAPI backend (see backend/app/main.py).
// Times are ISO-8601 UTC strings; power in MW.

export interface Metrics {
  n: number;
  mae_mw?: number;
  rmse_mw?: number;
  bias_mw?: number;
  mae_debiased_mw?: number;
  nmae_pct?: number | null;
  p50_abs_error_mw?: number;
  p90_abs_error_mw?: number;
  p99_abs_error_mw?: number;
  max_abs_error_mw?: number;
  over_forecast_pct?: number;
  within_1gw_pct?: number;
  correlation?: number | null;
  actual_mean_mw?: number;
}

export interface Meta {
  window_start: string;
  window_end: string;
  max_horizon_h: number;
  actual_points: number;
  forecast_points: number;
  forecast_runs: number;
  run_times_utc: string[];
  source?: string;
  loaded_from?: string;
  created_at?: string;
}

export interface TimeseriesResponse {
  start: string;
  end: string;
  horizon_h: number;
  actuals: { time: string; mw: number }[];
  forecasts: { time: string; mw: number; publish_time: string; lead_h: number }[];
  metrics: Metrics;
}

export interface HorizonRow {
  lead_from_h: number;
  lead_to_h: number;
  n: number;
  mae_mw: number;
  rmse_mw: number;
  bias_mw: number;
  mae_debiased_mw: number;
  error_p10_mw: number;
  error_p90_mw: number;
}

export interface Summary {
  n: number;
  mae_mw: number | null;
  bias_mw: number | null;
}

export interface AccuracyResponse {
  horizon_h: number;
  metrics: Metrics;
  by_hour: ({ hour: number } & Summary)[];
  by_level: ({ from_mw: number; to_mw: number | null } & Summary)[];
  histogram: { from_mw: number; to_mw: number; count: number }[];
}

export interface DayAheadRow {
  time: string;
  actual_mw: number | null;
  forecast_mw: number | null;
  publish_time: string | null;
  lead_h?: number;
  low_mw?: number | null;
  high_mw?: number | null;
  median_adjusted_mw?: number | null;
}

export interface DayAheadResponse {
  delivery_date: string;
  decision_at: string;
  forecast_runs_used: string[];
  latest_run_at_decision: string | null;
  calibration_samples: number;
  rows: DayAheadRow[];
  metrics: Metrics;
  energy: { forecast_mwh: number; actual_mwh: number; shortfall_mwh: number; hours: number };
  band_coverage_pct: number | null;
}
