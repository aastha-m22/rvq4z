from dataclasses import replace

from fastapi.testclient import TestClient

from app import store
from app.elexon import DataSourceError
from app.main import app


def test_snapshot_round_trip(tmp_path, raw, monkeypatch):
    actuals, forecasts = raw
    path = tmp_path / "snap.json.gz"
    store.dump(path, actuals, forecasts, "test")
    monkeypatch.setattr(store, "settings", replace(store.settings, snapshot_path=path))
    store.reset()
    try:
        ds, meta = store.get_dataset()
        assert meta["loaded_from"] == "snapshot"
        assert len(ds.actuals) == len(actuals)
        assert ds.actuals[0] == actuals[0]
    finally:
        store.reset()


def test_live_fetch_fallback_writes_cache(tmp_path, raw, monkeypatch):
    cache = tmp_path / "cache.json.gz"
    monkeypatch.setattr(
        store, "settings", replace(store.settings, snapshot_path=tmp_path / "none.gz", cache_path=cache)
    )
    monkeypatch.setattr(store, "fetch_live", lambda: raw)
    store.reset()
    try:
        _, meta = store.get_dataset()
        assert meta["loaded_from"] == "live"
        assert cache.exists()
    finally:
        store.reset()


def test_source_outage_returns_503(tmp_path, monkeypatch):
    monkeypatch.setattr(
        store,
        "settings",
        replace(store.settings, snapshot_path=tmp_path / "a.gz", cache_path=tmp_path / "b.gz"),
    )

    def down():
        raise DataSourceError("connection refused")

    monkeypatch.setattr(store, "fetch_live", down)
    store.reset()
    try:
        r = TestClient(app).get("/api/meta")
        assert r.status_code == 503
        assert "unavailable" in r.json()["detail"]
    finally:
        store.reset()
