"""Domain records. Plain frozen dataclasses: cheap, hashable, easy to test."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime


@dataclass(frozen=True, slots=True)
class Actual:
    """Measured national wind generation for one 30-minute settlement period."""

    time: datetime  # period start, UTC
    mw: float
    publish_time: datetime


@dataclass(frozen=True, slots=True)
class Forecast:
    """One forecast value: run `publish_time` predicting generation at `time`."""

    publish_time: datetime
    time: datetime  # target hour, UTC
    mw: float

    @property
    def lead_h(self) -> float:
        return (self.time - self.publish_time).total_seconds() / 3600
