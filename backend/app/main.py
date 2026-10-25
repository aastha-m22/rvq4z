"""HTTP API for the Wind Forecast Monitor.

Run locally:  uvicorn app.main:app --reload   (from backend/)
API docs:     http://localhost:8000/docs
"""

from __future__ import annotations

import logging
import math
from datetime import UTC, date, datetime, time, timedelta

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from . import analysis
from .config import settings
from .elexon import DataSourceError
from .store import get_dataset

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

app = FastAPI(
    title="Wind Forecast Monitor API",
    version="1.0.0",
    description="UK national wind generation: forecasts vs actuals (Elexon BMRS), January 2026.",
)
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(
    CORSMiddleware, allow_origins=list(settings.cors_origins), allow_methods=["GET"], allow_headers=["*"]
)


@app.exception_handler(DataSourceError)
def _data_source_down(_request: Request, exc: DataSourceError) -> JSONResponse:
    # Only reachable when there is no snapshot/cache and Elexon is unavailable.
    return JSONResponse(
        status_code=503,
        content={"detail": f"Data source unavailable, please retry shortly. ({exc})"},
        headers={"Retry-After": "30"},
    )


# --------------------------------------------------------------------------- helpers


def _json(value):
    """Make analysis output JSON-friendly: ISO-8601 UTC times, rounded floats."""
    if isinstance(value, datetime):
        return value.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    if isinstance(value, float):
        return None if math.isnan(value) or math.isinf(value) else round(value, 2)
    if isinstance(value, dict):
        return {k: _json(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_json(v) for v in value]
    return value


def _range(start: datetime | None, end: datetime | None) -> tuple[datetime, datetime]:
    """Default to, and clamp within, the analysis window."""
    lo, hi = settings.window_start, settings.window_end
    s = (start.astimezone(UTC) if start.tzinfo else start.replace(tzinfo=UTC)) if start else lo
    e = (end.astimezone(UTC) if end.tzinfo else end.replace(tzinfo=UTC)) if end else hi
    s, e = max(s, lo), min(e, hi)
    if s >= e:
        raise HTTPException(422, f"Empty range. Data covers {lo.isoformat()} to {hi.isoformat()}.")
    return s, e


StartQ = Query(None, description="Range start (ISO-8601; UTC if no offset). Defaults to window start.")
EndQ = Query(None, description="Range end, exclusive. Defaults to window end.")
HorizonQ = Query(
    4.0,
    ge=0,
    le=48,
    description="Forecast horizon in hours: use the latest forecast published at least this long before each target time.",
)


# --------------------------------------------------------------------------- routes


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/meta", summary="Dataset coverage and provenance")
def meta():
    ds, info = get_dataset()
    start, end = settings.window_start, settings.window_end
    pubs = [p for p in ds.publish_times if start - timedelta(hours=settings.max_horizon_h) <= p < end]
    return _json(
        {
            "window_start": start,
            "window_end": end,
            "max_horizon_h": settings.max_horizon_h,
            "actual_points": len(ds.actuals_between(start, end)),
            "forecast_points": sum(1 for f in ds.forecasts if start <= f.time < end),
            "forecast_runs": len(pubs),
            "run_times_utc": sorted({p.strftime("%H:%M") for p in pubs}),
            "timezone_note": "January is GMT, so UK local time equals UTC throughout the window.",
            **info,
        }
    )


@app.get("/api/timeseries", summary="Actuals and horizon-selected forecasts, with metrics")
def timeseries(start: datetime | None = StartQ, end: datetime | None = EndQ, horizon: float = HorizonQ):
    ds, _ = get_dataset()
    s, e = _range(start, end)
    pairs = ds.pairs_at_horizon(s, e, horizon)
    forecasts = []
    for t in ds.target_times(s, e):
        hit = ds.forecast_at_horizon(t, horizon)
        if hit:
            forecasts.append(
                {
                    "time": t,
                    "mw": hit[1],
                    "publish_time": hit[0],
                    "lead_h": (t - hit[0]).total_seconds() / 3600,
                }
            )
    return _json(
        {
            "start": s,
            "end": e,
            "horizon_h": horizon,
            "actuals": [{"time": a.time, "mw": a.mw} for a in ds.actuals_between(s, e)],
            "forecasts": forecasts,
            "metrics": analysis.metrics(pairs),
        }
    )


@app.get("/api/accuracy", summary="Error breakdowns at one horizon: by hour, by output level, histogram")
def accuracy(start: datetime | None = StartQ, end: datetime | None = EndQ, horizon: float = HorizonQ):
    ds, _ = get_dataset()
    s, e = _range(start, end)
    pairs = ds.pairs_at_horizon(s, e, horizon)
    return _json({"horizon_h": horizon, "metrics": analysis.metrics(pairs), **analysis.breakdowns(pairs)})


@app.get("/api/horizon-profile", summary="How accuracy degrades with lead time (all forecast runs)")
def horizon_profile(
    start: datetime | None = StartQ,
    end: datetime | None = EndQ,
    bucket: int = Query(1, ge=1, le=12, description="Lead-time bucket width in hours"),
):
    ds, _ = get_dataset()
    s, e = _range(start, end)
    return _json({"bucket_h": bucket, "rows": analysis.horizon_profile(ds, s, e, bucket)})


@app.get("/api/day-ahead", summary="The forecast a trader had at decision time, with a calibrated band")
def day_ahead(
    delivery_date: date = Query(date(2026, 1, 15), description="Delivery day (UK)"),
    decision_time: time = Query(
        time(9, 0), description="Decision time on the day before delivery (UK, HH:MM)"
    ),
):
    ds, _ = get_dataset()
    first, last = settings.window_start.date(), (settings.window_end - timedelta(seconds=1)).date()
    if not first <= delivery_date <= last:
        raise HTTPException(422, f"delivery_date must be between {first} and {last}")
    return _json(analysis.day_ahead(ds, delivery_date, decision_time, settings.calibration_days))


# Serve the built React app (Docker image / single-service deploys). Mounted last
# so /api/* routes win.
if settings.static_dir.is_dir():
    app.mount("/", StaticFiles(directory=settings.static_dir, html=True), name="frontend")
