"""Forecast selection and accuracy analysis. Pure functions over an in-memory dataset.

Key rule ("what did the forecaster know?")
------------------------------------------
For a target time T and a forecast horizon H hours, the forecast we evaluate is
the **latest run published at or before T - H** (and no more than 48 h before T).
H = 4 means "the forecast you would have been looking at 4 hours before delivery".

For the day-ahead view the same idea is expressed with a wall-clock decision
time instead of a horizon: the latest run published at or before the moment the
purchase decision is made.

Sign convention: error = forecast - actual. Positive error = over-forecast, which
for a utility means it under-bought and is exposed to buying the shortfall later.
"""

from __future__ import annotations

import math
from bisect import bisect_right
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from .models import Actual, Forecast

LONDON = ZoneInfo("Europe/London")
HOUR = timedelta(hours=1)


@dataclass(frozen=True, slots=True)
class Pair:
    time: datetime
    forecast_mw: float
    actual_mw: float
    publish_time: datetime

    @property
    def error_mw(self) -> float:
        return self.forecast_mw - self.actual_mw

    @property
    def lead_h(self) -> float:
        return (self.time - self.publish_time).total_seconds() / 3600


# --------------------------------------------------------------------------- stats


def quantile(sorted_values: list[float], q: float) -> float | None:
    """Linear-interpolated quantile of an already-sorted list (numpy's default)."""
    if not sorted_values:
        return None
    pos = (len(sorted_values) - 1) * q
    lo, hi = math.floor(pos), math.ceil(pos)
    if lo == hi:
        return sorted_values[lo]
    return sorted_values[lo] + (sorted_values[hi] - sorted_values[lo]) * (pos - lo)


def metrics(pairs: list[Pair]) -> dict:
    """Headline accuracy metrics for a set of forecast/actual pairs."""
    n = len(pairs)
    if n == 0:
        return {"n": 0}
    errors = [p.error_mw for p in pairs]
    abs_sorted = sorted(abs(e) for e in errors)
    actual_mean = sum(p.actual_mw for p in pairs) / n
    mae = sum(abs_sorted) / n
    rmse = math.sqrt(sum(e * e for e in errors) / n)
    bias = sum(errors) / n
    # Mean absolute error after removing the constant bias: how good the
    # forecast's *shape* is, independent of its systematic offset.
    mae_debiased = sum(abs(e - bias) for e in errors) / n

    fc = [p.forecast_mw for p in pairs]
    ac = [p.actual_mw for p in pairs]
    return {
        "n": n,
        "mae_mw": mae,
        "rmse_mw": rmse,
        "bias_mw": bias,
        "mae_debiased_mw": mae_debiased,
        "nmae_pct": 100 * mae / actual_mean if actual_mean else None,
        "p50_abs_error_mw": quantile(abs_sorted, 0.5),
        "p90_abs_error_mw": quantile(abs_sorted, 0.9),
        "p99_abs_error_mw": quantile(abs_sorted, 0.99),
        "max_abs_error_mw": abs_sorted[-1],
        "over_forecast_pct": 100 * sum(1 for e in errors if e > 0) / n,
        "within_1gw_pct": 100 * sum(1 for e in abs_sorted if e <= 1000) / n,
        "correlation": _pearson(fc, ac),
        "actual_mean_mw": actual_mean,
    }


def _pearson(x: list[float], y: list[float]) -> float | None:
    n = len(x)
    if n < 2:
        return None
    mx, my = sum(x) / n, sum(y) / n
    sxy = sum((a - mx) * (b - my) for a, b in zip(x, y, strict=True))
    sxx = sum((a - mx) ** 2 for a in x)
    syy = sum((b - my) ** 2 for b in y)
    return sxy / math.sqrt(sxx * syy) if sxx and syy else None


# --------------------------------------------------------------------------- dataset


class Dataset:
    """Actuals and forecasts indexed for fast "as-of" lookups."""

    def __init__(self, actuals: list[Actual], forecasts: list[Forecast], max_horizon_h: float = 48):
        self.max_horizon_h = max_horizon_h
        self.actuals = sorted(actuals, key=lambda a: a.time)
        self.actual_by_time = {a.time: a.mw for a in self.actuals}

        runs: dict[datetime, list[Forecast]] = defaultdict(list)
        for f in forecasts:
            if 0 <= f.lead_h <= max_horizon_h:
                runs[f.time].append(f)
        # target time -> (sorted publish times, matching forecast values)
        self._by_target: dict[datetime, tuple[list[datetime], list[float]]] = {}
        for t, fs in runs.items():
            fs.sort(key=lambda f: f.publish_time)
            self._by_target[t] = ([f.publish_time for f in fs], [f.mw for f in fs])
        self.forecasts = sorted(
            (f for fs in runs.values() for f in fs), key=lambda f: (f.time, f.publish_time)
        )
        self.publish_times = sorted({f.publish_time for f in self.forecasts})

    # ---- selection

    def forecast_as_of(self, target: datetime, as_of: datetime) -> tuple[datetime, float] | None:
        """Latest forecast for `target` published at or before `as_of`."""
        entry = self._by_target.get(target)
        if entry is None:
            return None
        pubs, values = entry
        i = bisect_right(pubs, as_of) - 1
        return (pubs[i], values[i]) if i >= 0 else None

    def forecast_at_horizon(self, target: datetime, horizon_h: float):
        return self.forecast_as_of(target, target - timedelta(hours=horizon_h))

    def target_times(self, start: datetime, end: datetime) -> list[datetime]:
        return sorted(t for t in self._by_target if start <= t < end)

    def pairs_at_horizon(self, start: datetime, end: datetime, horizon_h: float) -> list[Pair]:
        out = []
        for t in self.target_times(start, end):
            hit = self.forecast_at_horizon(t, horizon_h)
            actual = self.actual_by_time.get(t)
            if hit is not None and actual is not None:
                out.append(Pair(t, hit[1], actual, hit[0]))
        return out

    def all_pairs(self, start: datetime, end: datetime) -> list[Pair]:
        """Every forecast point (every run, every lead) that has a matching actual."""
        return [
            Pair(f.time, f.mw, self.actual_by_time[f.time], f.publish_time)
            for f in self.forecasts
            if start <= f.time < end and f.time in self.actual_by_time
        ]

    def actuals_between(self, start: datetime, end: datetime) -> list[Actual]:
        return [a for a in self.actuals if start <= a.time < end]


# --------------------------------------------------------------------------- analyses


def horizon_profile(ds: Dataset, start: datetime, end: datetime, bucket_h: int = 1) -> list[dict]:
    """Accuracy as a function of lead time, using every forecast run."""
    buckets: dict[int, list[Pair]] = defaultdict(list)
    for p in ds.all_pairs(start, end):
        buckets[int(p.lead_h // bucket_h) * bucket_h].append(p)
    rows = []
    for lead in sorted(buckets):
        ps = buckets[lead]
        m = metrics(ps)
        errs = sorted(p.error_mw for p in ps)
        rows.append(
            {
                "lead_from_h": lead,
                "lead_to_h": lead + bucket_h,
                "n": m["n"],
                "mae_mw": m["mae_mw"],
                "rmse_mw": m["rmse_mw"],
                "bias_mw": m["bias_mw"],
                "mae_debiased_mw": m["mae_debiased_mw"],
                "error_p10_mw": quantile(errs, 0.1),
                "error_p90_mw": quantile(errs, 0.9),
            }
        )
    return rows


LEVEL_BANDS_MW = [0, 4000, 8000, 12000, 16000, math.inf]


def breakdowns(pairs: list[Pair], hist_bin_mw: int = 500) -> dict:
    """Error by UK hour of day, by actual output level, and a signed-error histogram."""
    by_hour: dict[int, list[Pair]] = defaultdict(list)
    by_level: dict[int, list[Pair]] = defaultdict(list)
    hist: dict[int, int] = defaultdict(int)
    for p in pairs:
        by_hour[p.time.astimezone(LONDON).hour].append(p)
        for i in range(len(LEVEL_BANDS_MW) - 1):
            if LEVEL_BANDS_MW[i] <= p.actual_mw < LEVEL_BANDS_MW[i + 1]:
                by_level[i].append(p)
                break
        hist[math.floor(p.error_mw / hist_bin_mw) * hist_bin_mw] += 1

    def summary(ps: list[Pair]) -> dict:
        m = metrics(ps)
        return {"n": m["n"], "mae_mw": m.get("mae_mw"), "bias_mw": m.get("bias_mw")}

    return {
        "by_hour": [{"hour": h, **summary(by_hour[h])} for h in range(24) if by_hour[h]],
        "by_level": [
            {
                "from_mw": LEVEL_BANDS_MW[i],
                "to_mw": None if math.isinf(LEVEL_BANDS_MW[i + 1]) else LEVEL_BANDS_MW[i + 1],
                **summary(by_level[i]),
            }
            for i in sorted(by_level)
        ],
        "histogram": [{"from_mw": b, "to_mw": b + hist_bin_mw, "count": hist[b]} for b in sorted(hist)],
    }


def day_ahead(
    ds: Dataset,
    delivery_date: date,
    decision_time: time,
    calibration_days: int = 28,
    band_bucket_h: int = 6,
) -> dict:
    """What a trader would have seen when deciding on `delivery_date`, plus hindsight.

    The decision is made on the day before delivery at `decision_time` UK time.
    For each delivery hour we take the latest forecast published by then.

    The uncertainty band is built only from information available at decision
    time: forecast errors from the previous `calibration_days` days whose actuals
    were already known, at a similar lead time. That keeps it causally honest.
    """
    decision_at = datetime.combine(
        delivery_date - timedelta(days=1), decision_time, tzinfo=LONDON
    ).astimezone(UTC)
    day_start = datetime.combine(delivery_date, time(0), tzinfo=LONDON).astimezone(UTC)
    day_end = datetime.combine(delivery_date + timedelta(days=1), time(0), tzinfo=LONDON).astimezone(UTC)

    # Calibration pool: past errors, grouped by lead bucket.
    cal_start = decision_at - timedelta(days=calibration_days)
    pool: dict[int, list[float]] = defaultdict(list)
    for f in ds.forecasts:
        if cal_start <= f.time < decision_at and f.publish_time <= decision_at:
            actual = ds.actual_by_time.get(f.time)
            if actual is not None:
                pool[int(f.lead_h // band_bucket_h)].append(f.mw - actual)
    for errs in pool.values():
        errs.sort()

    rows, used_runs = [], set()
    for t in ds.target_times(day_start, day_end):
        hit = ds.forecast_as_of(t, decision_at)
        actual = ds.actual_by_time.get(t)
        row = {"time": t, "actual_mw": actual, "forecast_mw": None, "publish_time": None}
        if hit is not None:
            pub, mw = hit
            used_runs.add(pub)
            lead = (t - pub).total_seconds() / 3600
            errs = pool.get(int(lead // band_bucket_h), [])
            # actual = forecast - error  =>  P10 of actual uses P90 of error
            row.update(
                forecast_mw=mw,
                publish_time=pub,
                lead_h=lead,
                low_mw=mw - quantile(errs, 0.9) if len(errs) >= 20 else None,
                high_mw=mw - quantile(errs, 0.1) if len(errs) >= 20 else None,
                median_adjusted_mw=mw - quantile(errs, 0.5) if len(errs) >= 20 else None,
            )
        rows.append(row)

    pairs = [
        Pair(r["time"], r["forecast_mw"], r["actual_mw"], r["publish_time"])
        for r in rows
        if r["forecast_mw"] is not None and r["actual_mw"] is not None
    ]
    # Hourly forecasts -> MWh. Using the matched actual keeps the comparison like-for-like.
    fc_mwh = sum(p.forecast_mw for p in pairs)
    act_mwh = sum(p.actual_mw for p in pairs)
    with_band = [r for r in rows if r.get("low_mw") is not None and r["actual_mw"] is not None]
    inside = sum(1 for r in with_band if r["low_mw"] <= r["actual_mw"] <= r["high_mw"])
    return {
        "delivery_date": delivery_date.isoformat(),
        "decision_at": decision_at,
        "forecast_runs_used": sorted(used_runs),
        "latest_run_at_decision": max((p for p in ds.publish_times if p <= decision_at), default=None),
        "calibration_samples": sum(len(v) for v in pool.values()),
        "rows": rows,
        "metrics": metrics(pairs),
        "energy": {
            "forecast_mwh": fc_mwh,
            "actual_mwh": act_mwh,
            "shortfall_mwh": fc_mwh - act_mwh,
            "hours": len(pairs),
        },
        "band_coverage_pct": 100 * inside / len(with_band) if with_band else None,
    }
