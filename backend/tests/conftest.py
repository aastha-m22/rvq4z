"""Shared fixtures: a deterministic synthetic dataset with a known error structure.

Actual output follows a smooth daily sine wave. Every forecast is
    actual + 1000 MW (constant bias) + 10 MW per hour of lead time,
so expected metrics can be computed by hand.
"""

from __future__ import annotations

import math
from datetime import UTC, datetime, timedelta

import pytest

from app.analysis import Dataset
from app.models import Actual, Forecast

RUN_TIMES = [(2, 30), (4, 30), (7, 30), (9, 30), (11, 30), (15, 30), (18, 30), (22, 30)]


def actual_mw(t: datetime) -> float:
    hours = (t - datetime(2026, 1, 1, tzinfo=UTC)).total_seconds() / 3600
    return 10_000 + 3_000 * math.sin(2 * math.pi * hours / 24)


def build(start=datetime(2025, 12, 4, tzinfo=UTC), end=datetime(2026, 2, 1, tzinfo=UTC)):
    actuals = []
    t = start
    while t < end:
        actuals.append(Actual(t, actual_mw(t), t + timedelta(minutes=30)))
        t += timedelta(minutes=30)

    forecasts = []
    day = start - timedelta(days=3)
    while day < end:
        for hh, mm in RUN_TIMES:
            pub = day.replace(hour=hh, minute=mm)
            # Like WINDFOR, runs also contain a few targets in the past (negative lead).
            target = pub.replace(minute=0) - timedelta(hours=3)
            while target < pub + timedelta(hours=66):
                lead = (target - pub).total_seconds() / 3600
                forecasts.append(Forecast(pub, target, actual_mw(target) + 1000 + 10 * lead))
                target += timedelta(hours=1)
        day += timedelta(days=1)
    return actuals, forecasts


@pytest.fixture(scope="session")
def raw():
    return build()


@pytest.fixture(scope="session")
def dataset(raw) -> Dataset:
    return Dataset(*raw, max_horizon_h=48)
