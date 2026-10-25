"""Elexon client tests against a mocked HTTP transport.

Payloads mirror real responses from data.elexon.co.uk (checked Oct 2026).
"""

from datetime import UTC, datetime

import httpx

from app import elexon


def handler(request: httpx.Request) -> httpx.Response:
    p = request.url.params
    if request.url.path.endswith("/FUELHH/stream"):
        assert p["fuelType"] == "WIND"
        return httpx.Response(
            200,
            json=[
                {
                    "dataset": "FUELHH",
                    "publishTime": "2026-01-01T00:30:00Z",
                    "startTime": "2026-01-01T00:00:00Z",
                    "settlementDate": "2026-01-01",
                    "settlementPeriod": 1,
                    "fuelType": "WIND",
                    "generation": 15538,
                },
                # outside requested window -> trimmed
                {
                    "dataset": "FUELHH",
                    "publishTime": "2025-12-31T23:30:00Z",
                    "startTime": "2025-12-31T23:00:00Z",
                    "settlementDate": "2025-12-31",
                    "settlementPeriod": 47,
                    "fuelType": "WIND",
                    "generation": 1,
                },
                {
                    "dataset": "FUELHH",
                    "publishTime": "2026-01-01T00:30:00Z",
                    "startTime": "2026-01-01T00:00:00Z",
                    "settlementDate": "2026-01-01",
                    "settlementPeriod": 1,
                    "fuelType": "CCGT",
                    "generation": 9,
                },
            ],
        )
    if request.url.path.endswith("/WINDFOR/stream"):
        return httpx.Response(
            200,
            json=[
                {
                    "dataset": "WINDFOR",
                    "publishTime": "2025-12-31T22:30:00Z",
                    "startTime": "2026-01-01T02:00:00Z",
                    "generation": 19866,
                },
                # negative lead (target before publish) -> dropped
                {
                    "dataset": "WINDFOR",
                    "publishTime": "2026-01-01T02:30:00Z",
                    "startTime": "2026-01-01T01:00:00Z",
                    "generation": 1,
                },
                # lead > 48 h -> dropped
                {
                    "dataset": "WINDFOR",
                    "publishTime": "2025-12-29T02:30:00Z",
                    "startTime": "2026-01-01T03:00:00Z",
                    "generation": 2,
                },
            ],
        )
    return httpx.Response(404)


def client():
    return httpx.Client(base_url="https://example.test/api", transport=httpx.MockTransport(handler))


def test_fetch_actuals_filters_fuel_and_window():
    start, end = datetime(2026, 1, 1, tzinfo=UTC), datetime(2026, 1, 2, tzinfo=UTC)
    rows = elexon.fetch_actuals(client(), start, end)
    assert [(r.time, r.mw) for r in rows] == [(start, 15538.0)]


def test_fetch_forecasts_keeps_only_valid_leads():
    start, end = datetime(2026, 1, 1, tzinfo=UTC), datetime(2026, 1, 2, tzinfo=UTC)
    rows = elexon.fetch_forecasts(client(), start, end, max_horizon_h=48)
    assert len(rows) == 1
    assert rows[0].mw == 19866 and rows[0].lead_h == 3.5
