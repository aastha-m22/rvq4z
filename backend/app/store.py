"""Loads the dataset once per process and keeps it in memory.

Load order:
1. Bundled snapshot (backend/data/snapshot.json.gz) - fast, works offline, makes
   deployments independent of Elexon's availability. January 2026 is history, so
   the data will not change.
2. Runtime cache (CACHE_PATH) from an earlier live fetch.
3. Live fetch from Elexon, then written to the runtime cache.
"""

from __future__ import annotations

import gzip
import json
import logging
import threading
from datetime import UTC, datetime, timedelta
from pathlib import Path

from .analysis import Dataset
from .config import settings
from .models import Actual, Forecast

log = logging.getLogger(__name__)

_lock = threading.Lock()
_state: dict = {}


def _ts(epoch: int) -> datetime:
    return datetime.fromtimestamp(epoch, tz=UTC)


def _epoch(dt: datetime) -> int:
    return int(dt.timestamp())


def history_start() -> datetime:
    return settings.window_start - timedelta(days=settings.calibration_days)


def dump(path: Path, actuals: list[Actual], forecasts: list[Forecast], source: str) -> None:
    """Compact on-disk format: epoch seconds + MW, gzipped JSON (~200 KB)."""
    payload = {
        "version": 1,
        "source": source,
        "created_at": datetime.now(UTC).isoformat(),
        "history_start": history_start().isoformat(),
        "window_end": settings.window_end.isoformat(),
        "actuals": [[_epoch(a.time), a.mw, _epoch(a.publish_time)] for a in actuals],
        "forecasts": [[_epoch(f.publish_time), _epoch(f.time), f.mw] for f in forecasts],
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, "wt", encoding="utf-8") as fh:
        json.dump(payload, fh, separators=(",", ":"))


def _load_file(path: Path) -> tuple[list[Actual], list[Forecast], dict] | None:
    if not path.exists():
        return None
    try:
        with gzip.open(path, "rt", encoding="utf-8") as fh:
            payload = json.load(fh)
        actuals = [Actual(_ts(t), float(mw), _ts(p)) for t, mw, p in payload["actuals"]]
        forecasts = [Forecast(_ts(p), _ts(t), float(mw)) for p, t, mw in payload["forecasts"]]
        meta = {k: payload.get(k) for k in ("source", "created_at", "history_start")}
        return actuals, forecasts, meta
    except (OSError, ValueError, KeyError) as exc:
        log.warning("Ignoring unreadable data file %s: %s", path, exc)
        return None


def fetch_live() -> tuple[list[Actual], list[Forecast]]:
    from .elexon import fetch_all  # imported lazily so tests never touch the network

    return fetch_all(history_start(), settings.window_end, settings.max_horizon_h)


def get_dataset() -> tuple[Dataset, dict]:
    """Return the process-wide dataset, loading it on first use (thread-safe)."""
    if "dataset" in _state:
        return _state["dataset"], _state["meta"]
    with _lock:
        if "dataset" in _state:
            return _state["dataset"], _state["meta"]

        loaded = None
        for path, origin in ((settings.snapshot_path, "snapshot"), (settings.cache_path, "cache")):
            loaded = _load_file(path)
            if loaded:
                actuals, forecasts, meta = loaded
                meta["loaded_from"] = origin
                break
        if not loaded:
            log.info("No snapshot found, fetching from Elexon")
            actuals, forecasts = fetch_live()
            meta = {"source": "elexon-live", "loaded_from": "live"}
            try:
                dump(settings.cache_path, actuals, forecasts, "elexon-live")
            except OSError as exc:  # read-only filesystems (e.g. serverless) are fine
                log.warning("Could not write cache: %s", exc)

        meta["loaded_at"] = datetime.now(UTC).isoformat()
        _state["dataset"] = Dataset(actuals, forecasts, settings.max_horizon_h)
        _state["meta"] = meta
        return _state["dataset"], meta


def set_dataset(ds: Dataset, meta: dict | None = None) -> None:
    """Inject a dataset (used by tests)."""
    _state["dataset"] = ds
    _state["meta"] = meta or {"source": "test", "loaded_from": "test"}


def reset() -> None:
    _state.clear()
