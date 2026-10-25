"""Thin client for the two Elexon Insights datasets the app uses.

* FUELHH  - half-hourly outturn generation by fuel type (we keep fuelType=WIND)
* WINDFOR - wind generation forecasts; each forecast run (publishTime) covers
            hourly target times (startTime) from the recent past to ~3 days ahead

Both "stream" endpoints return a plain JSON array. Times are ISO-8601 UTC.
"""

from __future__ import annotations

import logging
import time
from datetime import UTC, datetime, timedelta

import httpx

from .config import settings
from .models import Actual, Forecast

log = logging.getLogger(__name__)

_RETRIES = 3


def parse_ts(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC)


def _iso(dt: datetime) -> str:
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _get_json(client: httpx.Client, path: str, params: dict) -> list[dict]:
    """GET with simple exponential backoff. Accepts a bare list or {"data": [...]}."""
    last_error: Exception | None = None
    for attempt in range(_RETRIES):
        try:
            resp = client.get(path, params=params)
            resp.raise_for_status()
            body = resp.json()
            return body["data"] if isinstance(body, dict) else body
        except (httpx.HTTPError, ValueError, KeyError) as exc:
            last_error = exc
            if attempt < _RETRIES - 1:
                wait = 2**attempt
                log.warning("Elexon %s failed (%s), retrying in %ss", path, exc, wait)
                time.sleep(wait)
    raise DataSourceError(f"Elexon request {path} failed after {_RETRIES} attempts: {last_error}")


class DataSourceError(RuntimeError):
    """Elexon could not be reached or returned unusable data."""


def fetch_actuals(client: httpx.Client, start: datetime, end: datetime) -> list[Actual]:
    """Wind outturn for target times in [start, end).

    FUELHH is filtered by settlement date, so we pad a day either side and trim.
    """
    params = {
        "settlementDateFrom": (start.date() - timedelta(days=1)).isoformat(),
        "settlementDateTo": (end.date() + timedelta(days=1)).isoformat(),
        "fuelType": "WIND",
    }
    rows = _get_json(client, "/datasets/FUELHH/stream", params)
    by_time: dict[datetime, Actual] = {}
    for row in rows:
        if row.get("fuelType") != "WIND" or row.get("generation") is None:
            continue
        t = parse_ts(row["startTime"])
        if start <= t < end:
            # If Elexon ever republishes a period, keep the latest publication.
            pub = parse_ts(row["publishTime"]) if row.get("publishTime") else t
            prev = by_time.get(t)
            if prev is None or pub >= prev.publish_time:
                by_time[t] = Actual(time=t, mw=float(row["generation"]), publish_time=pub)
    return sorted(by_time.values(), key=lambda a: a.time)


def fetch_forecasts(
    client: httpx.Client, start: datetime, end: datetime, max_horizon_h: float
) -> list[Forecast]:
    """Every forecast that targets [start, end) with a lead time of 0..max_horizon_h.

    WINDFOR is queried by publish time, so we request runs published from
    `start - max_horizon_h` up to `end`, in weekly chunks to keep responses small.
    """
    pub_from = start - timedelta(hours=max_horizon_h)
    out: dict[tuple[datetime, datetime], Forecast] = {}
    chunk_start = pub_from
    while chunk_start < end:
        chunk_end = min(chunk_start + timedelta(days=7), end)
        rows = _get_json(
            client,
            "/datasets/WINDFOR/stream",
            {"publishDateTimeFrom": _iso(chunk_start), "publishDateTimeTo": _iso(chunk_end)},
        )
        for row in rows:
            if row.get("generation") is None:
                continue
            t = parse_ts(row["startTime"])
            p = parse_ts(row["publishTime"])
            lead_h = (t - p).total_seconds() / 3600
            if start <= t < end and 0 <= lead_h <= max_horizon_h:
                out[(p, t)] = Forecast(publish_time=p, time=t, mw=float(row["generation"]))
        chunk_start = chunk_end
    return sorted(out.values(), key=lambda f: (f.time, f.publish_time))


def fetch_all(start: datetime, end: datetime, max_horizon_h: float):
    with httpx.Client(base_url=settings.elexon_base_url, timeout=settings.http_timeout_s) as client:
        actuals = fetch_actuals(client, start, end)
        forecasts = fetch_forecasts(client, start, end, max_horizon_h)
    log.info("Fetched %d actuals and %d forecast points", len(actuals), len(forecasts))
    return actuals, forecasts
