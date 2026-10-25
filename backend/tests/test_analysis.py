from datetime import UTC, date, datetime, time, timedelta

import pytest

from app.analysis import Dataset, Pair, breakdowns, day_ahead, horizon_profile, metrics, quantile
from app.models import Actual, Forecast
from tests.conftest import actual_mw

JAN = datetime(2026, 1, 1, tzinfo=UTC)
FEB = datetime(2026, 2, 1, tzinfo=UTC)


def dt(*a):
    return datetime(*a, tzinfo=UTC)


# ---------------------------------------------------------------- forecast selection


@pytest.mark.parametrize(
    "horizon, expected_pub",
    [
        (0, dt(2026, 1, 10, 11, 30)),  # cutoff 12:00 -> 11:30 run
        (1, dt(2026, 1, 10, 9, 30)),  # cutoff 11:00 -> 09:30 run
        (4, dt(2026, 1, 10, 7, 30)),  # cutoff 08:00 -> 07:30 run
        (4.5, dt(2026, 1, 10, 7, 30)),  # cutoff exactly at publish time is allowed
        (24, dt(2026, 1, 9, 11, 30)),
    ],
)
def test_selects_latest_run_published_before_cutoff(dataset, horizon, expected_pub):
    target = dt(2026, 1, 10, 12)
    pub, mw = dataset.forecast_at_horizon(target, horizon)
    assert pub == expected_pub
    lead = (target - pub).total_seconds() / 3600
    assert mw == pytest.approx(actual_mw(target) + 1000 + 10 * lead)


def test_never_uses_forecasts_older_than_48h(dataset):
    target = dt(2026, 1, 10, 12)
    # cutoff 13:00 two days earlier: the only earlier runs are > 48 h old
    assert dataset.forecast_at_horizon(target, 47) is None
    for f in dataset.forecasts:
        assert 0 <= f.lead_h <= 48


def test_ignores_runs_published_after_target():
    t = dt(2026, 1, 5, 10)
    ds = Dataset(
        [Actual(t, 100, t)],
        [Forecast(t - timedelta(hours=2), t, 120), Forecast(t + timedelta(hours=1), t, 999)],
    )
    assert ds.forecast_at_horizon(t, 0) == (t - timedelta(hours=2), 120)


def test_pairs_at_horizon_cover_every_january_hour(dataset):
    pairs = dataset.pairs_at_horizon(JAN, FEB, 4)
    assert len(pairs) == 31 * 24
    assert all(p.lead_h >= 4 for p in pairs)


# ---------------------------------------------------------------- metrics


def test_quantile_interpolates():
    assert quantile([1, 2, 3, 4], 0.5) == 2.5
    assert quantile([5], 0.9) == 5
    assert quantile([], 0.5) is None


def test_metrics_known_values():
    t = dt(2026, 1, 1)
    pairs = [Pair(t, f, a, t) for f, a in [(110, 100), (90, 100), (130, 100), (100, 100)]]
    m = metrics(pairs)
    assert m["n"] == 4
    assert m["mae_mw"] == pytest.approx(12.5)  # (10+10+30+0)/4
    assert m["bias_mw"] == pytest.approx(7.5)  # (10-10+30+0)/4
    assert m["rmse_mw"] == pytest.approx((1100 / 4) ** 0.5)
    assert m["nmae_pct"] == pytest.approx(12.5)
    assert m["over_forecast_pct"] == pytest.approx(50)
    assert metrics([]) == {"n": 0}


def test_constant_bias_is_detected(dataset):
    m = metrics(dataset.pairs_at_horizon(JAN, FEB, 4))
    # error = 1000 + 10 * lead, and leads at H=4 are 4.5..6.5 h
    assert 1040 < m["bias_mw"] < 1070
    assert m["mae_mw"] == pytest.approx(m["bias_mw"])  # all errors positive
    assert m["mae_debiased_mw"] < 20  # shape is near-perfect once bias is removed
    assert m["correlation"] == pytest.approx(1, abs=1e-3)


# ---------------------------------------------------------------- analyses


def test_horizon_profile_error_grows_with_lead(dataset):
    rows = horizon_profile(dataset, JAN, FEB, bucket_h=6)
    assert [r["lead_from_h"] for r in rows] == list(range(0, 48, 6))
    maes = [r["mae_mw"] for r in rows]
    assert maes == sorted(maes)


def test_breakdowns_shapes(dataset):
    b = breakdowns(dataset.pairs_at_horizon(JAN, FEB, 4))
    assert len(b["by_hour"]) == 24
    assert sum(h["count"] for h in b["histogram"]) == 31 * 24
    assert {lvl["from_mw"] for lvl in b["by_level"]} <= {0, 4000, 8000, 12000, 16000}


def test_day_ahead_uses_only_information_available_at_decision(dataset):
    res = day_ahead(dataset, date(2026, 1, 15), time(9, 0))
    assert res["decision_at"] == dt(2026, 1, 14, 9)
    assert res["forecast_runs_used"] == [dt(2026, 1, 14, 7, 30)]
    assert len(res["rows"]) == 24
    for r in res["rows"]:
        assert r["publish_time"] <= res["decision_at"]
        assert r["low_mw"] <= r["forecast_mw"] - 1000 <= r["forecast_mw"]
        assert r["low_mw"] <= r["high_mw"]
        # bias-adjusted forecast lands close to the truth
        assert abs(r["median_adjusted_mw"] - r["actual_mw"]) < 40
    assert res["band_coverage_pct"] > 50
    # every hour over-forecast by 1000 + 10*lead MW; leads run 16.5 .. 39.5 h
    expected = sum(1000 + 10 * (16.5 + i) for i in range(24))
    assert res["energy"]["shortfall_mwh"] == pytest.approx(expected)


def test_day_ahead_without_history_has_no_band():
    t0 = dt(2026, 1, 2)
    acts = [Actual(t0 + timedelta(hours=h), 100, t0) for h in range(24)]
    fcs = [Forecast(dt(2026, 1, 1, 7, 30), t0 + timedelta(hours=h), 150) for h in range(24)]
    res = day_ahead(Dataset(acts, fcs), date(2026, 1, 2), time(9, 0))
    assert all(r["low_mw"] is None for r in res["rows"])
    assert res["metrics"]["bias_mw"] == 50
