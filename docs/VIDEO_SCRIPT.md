# Video outline (10 minutes max)

Numbers below are from the live Elexon data for January 2026. Check them against the deployed app before recording.

---

## Part 1: Client presentation (≤ 5 min)

Audience: the utility's day-ahead purchasing team. Goal: show the pilot solves their problem and earns the next phase.

**0:00 – Their problem (30 s)**
- "Every morning you decide how much power to buy for tomorrow. Every MW of wind you count on is a MW you don't buy, so the wind forecast directly sets your position."
- "You asked for two things: see the latest forecast at the moment you decide, and know how much to trust it."

**0:30 – Day-ahead view (90 s)** (open the app on this tab)
- Pick a windy day, e.g. a mid-January weekday, decision time 09:00.
- Read the headline: which run was available (the 07:30 run), how old it was, what it expected.
- Point at the shaded band: "This is the range we'd expect actual output to fall in, 80% of the time. It's built only from errors we already knew about that morning, so it's honest."
- Turn on "Actual (hindsight)": the actual sits below the forecast. Read out the shortfall tile in GWh: "This is the energy you'd have had to buy after the auction."
- Click through a few days with Next to show this is the norm, not a one-off.

**2:00 – The key finding (90 s)** (Accuracy tab)
- "The forecast was too high in about 9 hours out of 10."
- "At 4 hours ahead the average miss is about 1.8 GW, and 1.65 GW of that is a consistent over-forecast, not random noise."
- Show the bias-by-hour chart: worst overnight (about +2.3 GW). Show the output-level chart: worst on windy hours (about +2.3 GW above 12 GW).
- "Across January, relying on the 09:00 day-before forecast meant counting on about 1,400 GWh of wind that never arrived, around 16% of the total."

**3:30 – Why this matters and what's next (60 s)**
- "Because the error is systematic, it's correctable. Just removing the average bias cuts the typical miss by about 30%."
- Likely cause to investigate: curtailment on windy, low-demand nights.
- Proposed phase 2: a bias-corrected forecast backtested on rolling history, live data instead of January only, and alerts when the forecast run changes materially before the auction.

**4:30 – Close (30 s)**
- Recap the two questions and how each tab answers them. Invite questions.

---

## Part 2: Technical review (≤ 5 min)

Audience: internal tech lead. Goal: make review easy and transfer knowledge.

**0:00 – Overview (45 s)**
- Diagram from the README: React + TypeScript UI → FastAPI → in-memory dataset ← Elexon.
- One Docker image serves both. Vercel deploy uses static UI + one Python function.

**0:45 – Data and the core rule (75 s)** (`backend/app/elexon.py`, `analysis.py`)
- FUELHH (half-hourly actuals) and WINDFOR (8 runs a day, hourly targets). Show the stream query params and the filtering: wind only, January targets, leads 0 to 48 h, negative leads dropped.
- `Dataset`: forecasts indexed by target time with sorted publish times. `forecast_as_of` is a binary search: latest run published at or before the cutoff.
- Horizon H → cutoff T − H. Day-ahead → cutoff = decision time.

**2:00 – Analysis (60 s)** (`analysis.py`)
- `metrics()`: MAE, RMSE, bias, bias-removed MAE, percentiles.
- `horizon_profile()` uses every run, bucketed by lead time.
- `day_ahead()`: the calibration pool only includes forecast/actual pairs known before the decision, from the previous 28 days. That's why the backend loads December as history.

**3:00 – Quality practices (60 s)**
- Pure-function core, tested against a synthetic dataset with a known bias, so expected metrics are derivable by hand (`tests/conftest.py`).
- API tests with an injected dataset; Elexon client tested with a mocked HTTP transport using real payload shapes.
- Input validation (horizon bounds, range clamping, 422s), CI running lint, tests, UI build and Docker build.
- Snapshot-first loading: deploys don't depend on Elexon uptime.

**4:00 – Frontend and wrap-up (60 s)** (`frontend/src`)
- Typed API client and response types, a small `useApi` hook that ignores stale responses.
- Colour-blind-safe palette, light/dark themes, legends on every chart, table view.
- Limitations and next steps from the README.
