# Meridian Intelligence Engine

An independent Python (FastAPI) microservice that turns raw Meridian database
records into **fully traceable operational intelligence**. It exists to
eliminate fake AI from the dashboard: every number, confidence, forecast and
recommendation it returns is computed, reproducible, and carries a trace back
to the query window, features and model that produced it.

```
React dashboard → Node/Express (auth + orchestration) → FastAPI engine → SQLite (read-only)
```

React never calls this service directly, and Node never computes intelligence.

## Run

```bash
cd intelligence
pip install -r requirements.txt
python -m uvicorn app.main:app --port 8010
# or from the repo root:  npm run intelligence
```

The engine reads the dev database at `../server/prisma/meridian.db`
(override with `MERIDIAN_DB`). It opens SQLite in read-only mode — it can
never write.

## API

- `GET /health` — engine + database status.
- `POST /intelligence/dashboard` `{"schoolId": "..."}` — full payload:
  `healthScore` (weighted, per-category contributions + formulas),
  `insights` (evidence, computed confidence, affected entities, trace),
  `recommendations` (priority = impact × urgency × confidence × affected ×
  risk, breakdown included), `anomalies` (IsolationForest, seeded),
  `forecasts` (with prediction intervals), `featureSummaries` (audit).

## Module layout (per the architecture spec)

- `app/feature_engineering/` — attendance, finance, staffing, timetable, documents, operations
- `app/anomaly_detection/` — IsolationForest scorers (seeded, reproducible)
- `app/forecasting/` — OLS/Poisson/aging-ratio forecasts with intervals
- `app/scoring/` — weighted health score (weights via `HEALTH_WEIGHTS` env)
- `app/recommendation_engine/` — evidence-driven ranked actions
- `app/inference/` — orchestrator that assembles insights + traces
- `app/training/` — offline model training (joblib artifacts in `models/`)
- `app/confidence.py` — the confidence arithmetic (signal × completeness × sample factor)
- `app/llm.py` — OPTIONAL prose polish; never computes numbers; engine fully works without it

## Honesty rules encoded here

1. **No hardcoded confidence.** `app/confidence.py` computes every value and
   returns the arithmetic in `components` + `explanation`.
2. **No invented causes.** Explanations cite class/grade/weekday deviations,
   late counts and other observable evidence. When evidence is insufficient
   the payload says "insufficient evidence" explicitly (e.g. trend with < 4
   school days, substitute demand with zero absence history).
3. **Models match the data.** With a freshly seeded school (~10 school days,
   132 students) heavy models would overfit; the engine uses interpretable
   statistics + IsolationForest, and states the model in every trace.
   `training/train_fee_risk.py` refuses to train a supervised model until
   enough labelled payment history exists — and records why.
4. **Reproducible.** Fixed seeds; same database in → same payload out
   (timestamps aside).
