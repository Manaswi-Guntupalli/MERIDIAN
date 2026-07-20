"""Forecasting with prediction intervals.

Method choice is data-driven and stated in every forecast's trace:
- Attendance: OLS trend + t-distributed prediction interval on residuals.
  With ~10 school days, a heavier model (Prophet/LightGBM) would only
  overfit; the interval honestly reflects how little history exists.
- Substitute demand: Poisson rate estimate from observed absence counts;
  when zero events observed, the rule-of-three upper bound (3/n) is reported
  instead of a fake point estimate.
- Fee collections: expected recovery = sum over aging buckets of
  outstanding x observed collected-ratio for that bucket, with the ratio's
  spread carried into the interval.
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd
from scipy import stats


def attendance_tomorrow(daily: pd.DataFrame) -> dict:
    n = len(daily)
    if n < 5:
        return {"available": False, "reason": f"Only {n} school day(s) of history; at least 5 needed."}
    x = np.arange(n, dtype=float)
    y = daily["rate"].to_numpy(dtype=float)
    slope, intercept, r, p, stderr = stats.linregress(x, y)
    pred = float(np.clip(intercept + slope * n, 0, 1))
    resid = y - (intercept + slope * x)
    s = float(np.std(resid, ddof=2)) if n > 2 else 0.05
    # 80% prediction interval, t-distribution, accounting for extrapolation
    tval = stats.t.ppf(0.9, df=max(n - 2, 1))
    se_pred = s * math.sqrt(1 + 1 / n + (n - x.mean()) ** 2 / max(((x - x.mean()) ** 2).sum(), 1e-9))
    lo, hi = float(np.clip(pred - tval * se_pred, 0, 1)), float(np.clip(pred + tval * se_pred, 0, 1))
    return {
        "available": True,
        "prediction": round(pred, 4),
        "interval80": [round(lo, 4), round(hi, 4)],
        "model": "OLS trend + t-distribution prediction interval",
        "n_days": n,
        "window": [str(daily['date'].iloc[0]), str(daily['date'].iloc[-1])],
    }


def substitute_demand(absence_days: int, school_days: int, n_teachers: int) -> dict:
    if school_days == 0 or n_teachers == 0:
        return {"available": False, "reason": "No observed school days yet."}
    if absence_days == 0:
        upper_daily = 3 / school_days  # rule of three, 95% upper bound on daily absences
        return {
            "available": True,
            "prediction": 0.0,
            "interval95_upper": round(upper_daily, 2),
            "model": "Poisson rate, zero-event rule-of-three upper bound",
            "note": f"0 absences across {school_days} school days x {n_teachers} teachers — "
            f"expected demand tomorrow is 0; 95% upper bound {upper_daily:.1f} absence(s)/day.",
            "n_days": school_days,
        }
    rate = absence_days / school_days
    lo = stats.chi2.ppf(0.1, 2 * absence_days) / (2 * school_days)
    hi = stats.chi2.ppf(0.9, 2 * (absence_days + 1)) / (2 * school_days)
    return {
        "available": True,
        "prediction": round(rate, 2),
        "interval80": [round(float(lo), 2), round(float(hi), 2)],
        "model": "Poisson rate with chi-square interval",
        "n_days": school_days,
    }


def fee_collections(finance: dict) -> dict:
    if finance.get("insufficient"):
        return {"available": False, "reason": "No fee records."}
    expected = 0.0
    parts = []
    for bucket, recov in zip(finance["aging_buckets"], finance["recovery_by_bucket"]):
        ratio = recov.get("collected_ratio")
        if ratio is None:
            continue
        contribution = bucket["outstanding"] * ratio
        expected += contribution
        parts.append({
            "bucket": bucket["bucket"],
            "outstanding": bucket["outstanding"],
            "observed_collected_ratio": ratio,
            "expected_recovery": round(contribution, 2),
        })
    lo = sum(b["outstanding"] * r["fully_paid_wilson95"][0] for b, r in zip(finance["aging_buckets"], finance["recovery_by_bucket"]))
    hi = sum(b["outstanding"] * r["fully_paid_wilson95"][1] for b, r in zip(finance["aging_buckets"], finance["recovery_by_bucket"]))
    return {
        "available": True,
        "prediction": round(expected, 2),
        "interval95": [round(lo, 2), round(hi, 2)],
        "model": "Aging-bucket recovery ratios (cross-sectional) x outstanding, Wilson 95% bounds",
        "parts": parts,
        "caveat": None if finance["payment_history_available"] else
        "No longitudinal Payment history yet — ratios are cross-sectional observations, not a trained model.",
    }


def document_review_load(docs: dict) -> dict:
    if docs.get("insufficient"):
        return {"available": False, "reason": "No documents."}
    return {
        "available": True,
        "prediction": docs["review_queue"],
        "model": "Current queue depth (no arrival-rate history to extrapolate from)",
        "note": "Forecast equals present queue; arrival-rate modelling activates once upload history accumulates.",
    }
