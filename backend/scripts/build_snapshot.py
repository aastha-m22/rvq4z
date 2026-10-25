"""Download the analysis data from Elexon once and save it as the bundled snapshot.

    cd backend && python -m scripts.build_snapshot

Commit backend/data/snapshot.json.gz afterwards: the deployed app then starts
instantly and does not depend on Elexon being reachable.
"""

from __future__ import annotations

import logging
from datetime import timedelta

from app.analysis import Dataset, metrics
from app.config import settings
from app.store import dump, fetch_live, history_start


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    actuals, forecasts = fetch_live()
    dump(settings.snapshot_path, actuals, forecasts, "elexon-snapshot")

    ds = Dataset(actuals, forecasts, settings.max_horizon_h)
    s, e = settings.window_start, settings.window_end
    print(f"Saved {settings.snapshot_path}")
    print(
        f"  history from {history_start():%Y-%m-%d}, window {s:%Y-%m-%d} .. {e - timedelta(seconds=1):%Y-%m-%d}"
    )
    print(f"  {len(actuals)} actuals, {len(forecasts)} forecast points, {len(ds.publish_times)} runs")
    m = metrics(ds.pairs_at_horizon(s, e, 4))
    print(f"  January @ 4h horizon: n={m['n']} MAE={m['mae_mw']:.0f} MW bias={m['bias_mw']:+.0f} MW")


if __name__ == "__main__":
    main()
