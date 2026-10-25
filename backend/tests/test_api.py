import pytest
from fastapi.testclient import TestClient

from app import store
from app.main import app


@pytest.fixture()
def client(dataset):
    store.set_dataset(dataset)
    yield TestClient(app)
    store.reset()


def test_health(client):
    assert client.get("/api/health").json() == {"status": "ok"}


def test_meta(client):
    body = client.get("/api/meta").json()
    assert body["actual_points"] == 31 * 48
    assert body["run_times_utc"] == ["02:30", "04:30", "07:30", "09:30", "11:30", "15:30", "18:30", "22:30"]


def test_timeseries_defaults_to_full_window(client):
    body = client.get("/api/timeseries").json()
    assert body["horizon_h"] == 4
    assert len(body["actuals"]) == 31 * 48
    assert len(body["forecasts"]) == 31 * 24
    assert body["actuals"][0]["time"] == "2026-01-01T00:00:00Z"
    assert body["metrics"]["n"] == 31 * 24


def test_timeseries_range_and_horizon(client):
    body = client.get(
        "/api/timeseries",
        params={"start": "2026-01-10T00:00:00Z", "end": "2026-01-11T00:00:00Z", "horizon": 24},
    ).json()
    assert len(body["actuals"]) == 48
    assert all(f["lead_h"] >= 24 for f in body["forecasts"])


def test_range_is_clamped_to_january(client):
    body = client.get("/api/timeseries", params={"start": "2025-06-01T00:00:00Z"}).json()
    assert body["start"] == "2026-01-01T00:00:00Z"


@pytest.mark.parametrize(
    "params",
    [
        {"horizon": 49},
        {"horizon": -1},
        {"start": "2026-01-20T00:00:00Z", "end": "2026-01-10T00:00:00Z"},
        {"start": "not-a-date"},
    ],
)
def test_bad_input_is_rejected(client, params):
    assert client.get("/api/timeseries", params=params).status_code == 422


def test_accuracy_and_profile(client):
    acc = client.get("/api/accuracy", params={"horizon": 8}).json()
    assert len(acc["by_hour"]) == 24 and acc["histogram"]
    prof = client.get("/api/horizon-profile", params={"bucket": 3}).json()
    assert prof["rows"][0]["lead_from_h"] == 0 and prof["bucket_h"] == 3


def test_day_ahead(client):
    body = client.get(
        "/api/day-ahead", params={"delivery_date": "2026-01-20", "decision_time": "10:00"}
    ).json()
    assert body["decision_at"] == "2026-01-19T10:00:00Z"
    assert body["forecast_runs_used"] == ["2026-01-19T09:30:00Z"]
    assert len(body["rows"]) == 24


def test_day_ahead_outside_window(client):
    r = client.get("/api/day-ahead", params={"delivery_date": "2026-03-01"})
    assert r.status_code == 422
