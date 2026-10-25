# Wind Forecast Monitor

A web app for a UK energy utility's day-ahead purchasing team. It answers two questions about national wind generation in January 2026, using Elexon BMRS data:

1. **What was the latest wind forecast when we had to decide?** For any delivery day and decision time, it shows the forecast that was actually available then, with an uncertainty range built only from information known at the time.
2. **How far can we trust that forecast?** It measures accuracy against what was actually generated, by forecast horizon, time of day and output level.

**Live app:** `<add your Vercel or Heroku URL here>`

**Video walkthrough:** `<add your unlisted YouTube link here>`

---

## Quick start

### With Docker (recommended)

```bash
docker compose up --build
# open http://localhost:8000          (UI)
# open http://localhost:8000/docs     (interactive API docs)
```

One container builds the React UI and serves it from the FastAPI backend, so there is a single origin and no CORS setup.

### Without Docker (development)

Requires Python 3.11+ and Node 20+.

```bash
# Terminal 1: API on :8000
cd backend
python -m venv .venv && source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
python -m scripts.build_snapshot      # optional, see "Data" below
uvicorn app.main:app --reload

# Terminal 2: UI on :5173 (proxies /api to :8000)
cd frontend
npm install
npm run dev
```

### Tests

```bash
cd backend && pytest -q && ruff check .      # 32 tests: selection logic, metrics, API, data loading, Elexon client
cd frontend && npm test                      # formatting and data-merge tests
```

CI (`.github/workflows/ci.yml`) runs both suites, a production UI build and a Docker build on every push.

---

## Data

| Dataset | Endpoint | Used fields | Notes |
|---|---|---|---|
| Actual generation | `FUELHH/stream`, `fuelType = WIND` | `startTime`, `generation` | Half-hourly, MW |
| Forecasts | `WINDFOR/stream` | `startTime`, `publishTime`, `generation` | Hourly targets. 8 runs a day, published at 02:30, 04:30, 07:30, 09:30, 11:30, 15:30, 18:30 and 22:30 UTC, each looking up to ~66 h ahead |

- **Window:** target times from 1 Jan 2026 00:00 to 31 Jan 23:30. January is GMT, so UK time equals UTC throughout.
- **Horizon limit:** only forecasts published 0 to 48 h before their target time are used. Rows where the target is before the publish time (WINDFOR includes some) are dropped.
- **Calibration history:** the backend also loads the 28 days before the window (December 2025). This is used only to build the uncertainty band in the day-ahead view, so that a decision on 1 January uses only errors known by then. All charts and metrics cover January only.
- **Loading:** on startup the API loads `backend/data/snapshot.json.gz` if it exists, otherwise a runtime cache, otherwise it fetches from Elexon (about 2 seconds) and caches the result. Run `python -m scripts.build_snapshot` once and commit the snapshot so deployments start instantly and don't depend on Elexon being up. January 2026 is history, so the data won't change.

---

## Product

| Tab | For | What it shows |
|---|---|---|
| **Day-ahead view** | The trader making tomorrow's purchase | Pick a delivery day and a decision time (default 09:00 the day before). Shows which forecast run was available, its hourly profile and an 80% likely range calibrated on the previous 28 days' errors at similar lead times. Optionally overlays the actual and a bias-adjusted forecast. Reports forecast vs actual energy for the day and the resulting shortfall or surplus. |
| **Forecast vs actual** | Anyone reviewing a period | Any date range in January, any horizon from 0 to 47 h. Actual (30 min) and forecast (hourly) on one chart, with headline error metrics. |
| **Accuracy analysis** | The analyst deciding how much to trust the forecast | Error vs lead time (MAE, bias, bias-removed MAE, P10 to P90 error band) with the day-ahead window highlighted; error histogram; bias by hour of day; error by output level; full metric table; auto-generated plain-English findings. |

### Forecast selection rule

For target time **T** and horizon **H**, the app uses the **latest forecast published at or before T − H**, and no more than 48 h before T. So "4 h horizon" means "what you would have been looking at 4 hours before delivery". The day-ahead view applies the same rule with a wall-clock cutoff instead: the latest run published at or before the decision time.

Forecasts are hourly and actuals half-hourly. Errors are measured on the hourly targets, matched to the half-hour starting at the same `startTime`.

### Metrics

Error = forecast − actual. Positive means the forecast promised more wind than arrived, so the utility under-bought and has to cover the gap later.

MAE, RMSE, bias (mean error), MAE with bias removed, MAE as % of mean output, median / P90 / P99 / max absolute error, % of hours over-forecast, % within ±1 GW, and correlation.

### What January 2026 shows

Measured on the live Elexon data:

| Horizon | MAE | Bias | MAE as % of mean output |
|---|---|---|---|
| 4 h | 1.84 GW | +1.65 GW | 15.9% |
| 12 h | 1.90 GW | +1.70 GW | 16.4% |
| 24 h | 2.05 GW | +1.85 GW | 17.7% |
| 36 h | 2.26 GW | +1.95 GW | 19.5% |

- **The forecast is systematically too high.** At 4 h it over-forecast in 88% of hours. Removing the average bias alone would cut MAE from 1.84 GW to 1.26 GW.
- **The bias grows with wind output.** Above 12 GW actual, the forecast ran about +2.2 to +2.4 GW high; below 8 GW it was about +0.9 to +1.2 GW.
- **It's worst overnight.** Bias is about +2.2 to +2.4 GW from 00:00 to 06:00 and about +1.0 GW around midday.
- **Day-ahead impact:** using the 09:00 day-before forecast for every January hour, forecast wind energy was about 9,990 GWh against 8,620 GWh actual, roughly 1,380 GWh (16%) more than arrived.

A plausible explanation, not tested here, is wind curtailment: the forecast may represent available wind, while the measured outturn is after constraint actions, which are most common on windy, low-demand nights. Confirming this with Elexon balancing data (for example BOALF bid-offer acceptances for wind units) would be the natural next step.

---

## Architecture

```
React + TypeScript + Recharts (Vite)
        │  GET /api/*  (JSON)
        ▼
FastAPI ─── analysis.py   pure functions: selection, metrics, breakdowns, day-ahead
   │    └── store.py      load once per process: snapshot → cache → live fetch
   ▼
elexon.py ──► data.elexon.co.uk  (FUELHH, WINDFOR stream endpoints)
```

**Design decisions**

- **Precompute nothing, index everything.** The full dataset is about 40k forecast points. It's held in memory, indexed by target time with sorted publish times, so each "latest forecast before time X" lookup is a binary search. Every endpoint responds in about 30 ms or less, so any range or horizon can be computed on demand.
- **Pure-function analysis core.** `analysis.py` has no I/O and no framework imports, so all the domain logic is unit-tested against a synthetic dataset with a known error structure (`tests/conftest.py`), where expected metrics can be derived by hand.
- **No look-ahead.** The selection rule, the decision-time cutoff, and the rolling 28-day calibration window all make sure the app only uses information that existed at the moment being analysed.
- **Snapshot-first data loading.** Removes a runtime dependency on a third-party API for historical data, with automatic fallback to live fetching.
- **Minimal dependencies.** The backend uses only FastAPI, httpx and the standard library (no pandas or numpy), which keeps the Docker image small and the serverless cold start fast.
- **Typed UI.** TypeScript response types (`frontend/src/types.ts`) mirror the API. Chart colours use a colour-blind-safe palette with light and dark themes. Every chart has a legend and tooltips, and the day-ahead chart has a table view.

### API

Interactive docs at `/docs`. All times are ISO-8601 UTC. `start` and `end` default to the January window and are clamped to it.

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Liveness |
| `GET /api/meta` | Coverage and provenance |
| `GET /api/timeseries?start&end&horizon` | Actuals + horizon-selected forecasts + metrics |
| `GET /api/accuracy?start&end&horizon` | Metrics plus breakdowns by hour, by output level, histogram |
| `GET /api/horizon-profile?start&end&bucket` | Metrics per lead-time bucket, using every forecast run |
| `GET /api/day-ahead?delivery_date&decision_time` | Forecast at decision time, calibrated band, energy totals |

### Configuration

All optional, via environment variables (see `backend/app/config.py`): `WINDOW_START`, `WINDOW_END`, `MAX_HORIZON_H`, `CALIBRATION_DAYS`, `SNAPSHOT_PATH`, `CACHE_PATH`, `ELEXON_BASE_URL`, `CORS_ORIGINS`. Frontend: `VITE_API_BASE` if the API is on a different origin.

---

## Repository layout

```
.
├── backend/
│   ├── app/
│   │   ├── main.py          FastAPI routes, input validation, serves the built UI
│   │   ├── analysis.py      Forecast selection, metrics, breakdowns, day-ahead view
│   │   ├── store.py         Data loading (snapshot → cache → live) and on-disk format
│   │   ├── elexon.py        Elexon Insights API client with retries
│   │   ├── models.py        Actual / Forecast records
│   │   └── config.py        Environment-driven settings
│   ├── scripts/
│   │   └── build_snapshot.py   Downloads data and writes data/snapshot.json.gz
│   ├── tests/               pytest: analysis, API, Elexon client (mocked HTTP)
│   ├── data/                Bundled data snapshot
│   ├── requirements.txt / requirements-dev.txt / pyproject.toml
├── frontend/
│   ├── src/
│   │   ├── App.tsx          Layout, tabs, provenance header
│   │   ├── api.ts           Typed API client and fetch hook
│   │   ├── types.ts         API response types
│   │   ├── format.ts        Units, times (Europe/London), axis ticks
│   │   ├── theme.css        Design tokens, light/dark themes, layout
│   │   └── components/
│   │       ├── DayAheadView.tsx   Decision-time view
│   │       ├── ExplorerView.tsx   Range + horizon explorer (shared controls)
│   │       ├── AccuracyView.tsx   Horizon profile and error breakdowns
│   │       └── ui.tsx             Tiles, cards, legends, tooltips, theme palette hook
│   ├── index.html, vite.config.ts, tsconfig.json, package.json
├── api/index.py             Vercel serverless entry (wraps the FastAPI app)
├── Dockerfile               Multi-stage: build UI, then Python runtime serving UI + API
├── docker-compose.yml       One-command local run
├── vercel.json              Vercel: static UI + Python function for /api/*
├── heroku.yml               Heroku container deploy
├── requirements.txt         Python deps for the Vercel function
├── docs/VIDEO_SCRIPT.md     Outline for the demo and technical walkthrough videos
└── .github/workflows/ci.yml Lint, tests, UI build, Docker build
```

---

## Deployment

**Vercel**

1. Run `cd backend && python -m scripts.build_snapshot` and commit `backend/data/snapshot.json.gz`.
2. Import the repo in Vercel. `vercel.json` builds the UI as static files and deploys `api/index.py` as a Python function for `/api/*`.

**Heroku (container)**

```bash
heroku create
heroku stack:set container
git push heroku main
```

---

## Limitations and next steps

- National totals only, as scoped. Regional or BMU-level data would show where the bias comes from.
- The uncertainty band uses empirical error quantiles by lead-time bucket. A model conditioned on forecast level and time of day (both clearly matter, see above) would be tighter.
- A bias-corrected forecast is shown as an overlay but not validated out-of-sample. Backtesting a rolling correction would be the obvious first improvement to propose.
- Accuracy is measured against the half-hour starting on the hour. Averaging both half-hours of each hour is an alternative convention.

---

## Use of AI tools

This project was built with help from Claude (Anthropic) as a coding assistant: scaffolding the backend and frontend, writing tests, and drafting documentation. I reviewed, ran and tested the code, checked the Elexon data and analysis results, and made the product and design decisions.
