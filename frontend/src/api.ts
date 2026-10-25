import { useEffect, useState } from "react";
import type { AccuracyResponse, DayAheadResponse, HorizonRow, Meta, TimeseriesResponse } from "./types";

// Same-origin by default (FastAPI serves the built UI, Vite proxies in dev).
// Set VITE_API_BASE when the UI and API are deployed separately.
const BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, "") ?? "";

export class ApiError extends Error {}

async function get<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") qs.set(k, String(v));
  const url = `${BASE}${path}${qs.size ? `?${qs}` : ""}`;
  const res = await fetch(url);
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(`${res.status}: ${detail}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  meta: () => get<Meta>("/api/meta"),
  timeseries: (start: string, end: string, horizon: number) =>
    get<TimeseriesResponse>("/api/timeseries", { start, end, horizon }),
  accuracy: (start: string, end: string, horizon: number) =>
    get<AccuracyResponse>("/api/accuracy", { start, end, horizon }),
  horizonProfile: (start: string, end: string, bucket = 1) =>
    get<{ bucket_h: number; rows: HorizonRow[] }>("/api/horizon-profile", { start, end, bucket }),
  dayAhead: (deliveryDate: string, decisionTime: string) =>
    get<DayAheadResponse>("/api/day-ahead", { delivery_date: deliveryDate, decision_time: decisionTime }),
};

/** Fetch on dependency change; stale responses from earlier requests are ignored. */
export function useApi<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    fn()
      .then((data) => live && setState({ data, loading: false }))
      .catch((e: unknown) => live && setState({ error: e instanceof Error ? e.message : String(e), loading: false }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}
