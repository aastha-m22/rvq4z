"""Runtime configuration, read once from environment variables.

Every setting has a sensible default so the app runs with zero configuration.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent


def _utc(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(UTC)


@dataclass(frozen=True)
class Settings:
    # Elexon Insights Solution API (public, no key needed).
    elexon_base_url: str = os.getenv("ELEXON_BASE_URL", "https://data.elexon.co.uk/bmrs/api/v1")
    http_timeout_s: float = float(os.getenv("HTTP_TIMEOUT_S", "30"))

    # Analysis window: target (delivery) times in January 2026, UTC.
    # UK is on GMT in January, so UTC == UK local time for the whole window.
    window_start: datetime = field(
        default_factory=lambda: _utc(os.getenv("WINDOW_START", "2026-01-01T00:00:00Z"))
    )
    window_end: datetime = field(
        default_factory=lambda: _utc(os.getenv("WINDOW_END", "2026-02-01T00:00:00Z"))
    )

    # Extra history loaded before the window, used only to calibrate uncertainty
    # bands (a trader on 1 Jan already knows how December's forecasts performed).
    calibration_days: int = int(os.getenv("CALIBRATION_DAYS", "28"))

    # Only forecasts made 0..48 h before their target time are considered.
    max_horizon_h: float = float(os.getenv("MAX_HORIZON_H", "48"))

    # Bundled snapshot (committed to the repo) and a writable runtime cache.
    snapshot_path: Path = Path(os.getenv("SNAPSHOT_PATH", str(BACKEND_DIR / "data" / "snapshot.json.gz")))
    cache_path: Path = Path(os.getenv("CACHE_PATH", "/tmp/wind-monitor-cache.json.gz"))

    # Built React app, served by FastAPI in the Docker image.
    static_dir: Path = Path(os.getenv("STATIC_DIR", str(BACKEND_DIR.parent / "frontend" / "dist")))

    cors_origins: tuple[str, ...] = tuple(
        o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",") if o.strip()
    )


settings = Settings()
