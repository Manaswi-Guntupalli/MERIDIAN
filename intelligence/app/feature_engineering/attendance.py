"""Attendance feature engineering.

Everything here is derived from the Attendance / AttendanceEvent tables.
No feature is invented; each carries enough metadata to be traced back to
raw rows (dates, class ids, counts).
"""
from __future__ import annotations

import math

import pandas as pd
from scipy import stats

ATTENDED = ("PRESENT", "LATE")

# A day only speaks for the school once at least half of it is marked — the
# same representative-coverage rule the Node stats route applies. A morning
# with 44/132 marked (all present) would otherwise enter the window as a
# "100% day" and bias trend, forecast, anomalies and health.
REPRESENTATIVE_COVERAGE = 0.5


def daily_rates(attendance: pd.DataFrame, active_students: int) -> pd.DataFrame:
    """Per school-day: marks, attended, rate, late/absent share, coverage."""
    if attendance.empty:
        return pd.DataFrame(columns=["date", "marks", "attended", "rate", "late", "absent", "coverage", "partial"])
    g = attendance.groupby("date")
    out = pd.DataFrame({
        "marks": g.size(),
        "attended": g.apply(lambda d: d["status"].isin(ATTENDED).sum(), include_groups=False),
        "late": g.apply(lambda d: (d["status"] == "LATE").sum(), include_groups=False),
        "absent": g.apply(lambda d: (d["status"] == "ABSENT").sum(), include_groups=False),
    }).reset_index()
    out["rate"] = out["attended"] / out["marks"]
    out["coverage"] = out["marks"] / active_students if active_students else 0.0
    out["partial"] = out["coverage"] < REPRESENTATIVE_COVERAGE
    return out.sort_values("date").reset_index(drop=True)


def trend(daily: pd.DataFrame) -> dict:
    """OLS slope of the daily rate over school days. Returns slope per day,
    p-value, r^2 and the rolling-average movement used as headline evidence."""
    n = len(daily)
    if n < 4:
        return {"n": n, "slope": 0.0, "p_value": 1.0, "r2": 0.0, "insufficient": True}
    x = pd.RangeIndex(n).to_numpy(dtype=float)
    y = daily["rate"].to_numpy(dtype=float)
    res = stats.linregress(x, y)
    # A perfectly flat window (every student present every day) has zero
    # variance, so the correlation — and with it p-value and r² — is undefined
    # and scipy returns NaN. That is not "unknown", it is "no detectable
    # trend": the honest p-value is 1.0 (the null cannot be rejected). Passing
    # the NaN through crashed confidence.build(), taking the whole engine down
    # for a school whose attendance was flawless.
    slope = float(res.slope) if math.isfinite(res.slope) else 0.0
    p_value = float(res.pvalue) if math.isfinite(res.pvalue) else 1.0
    r2 = float(res.rvalue**2) if math.isfinite(res.rvalue) else 0.0
    stderr = float(res.stderr) if math.isfinite(res.stderr) else 0.0
    half = max(2, n // 2)
    first = float(daily["rate"].head(half).mean())
    last = float(daily["rate"].tail(half).mean())
    roll5 = daily["rate"].rolling(5, min_periods=2).mean()
    return {
        "n": n,
        "slope": slope,
        "p_value": p_value,
        "r2": r2,
        "stderr": stderr,
        "window": [str(daily["date"].iloc[0]), str(daily["date"].iloc[-1])],
        "first_half_avg": first,
        "last_half_avg": last,
        "change_pct_points": (last - first) * 100,
        "rolling5_start": float(roll5.iloc[max(0, n - 6)]) if n >= 2 else None,
        "rolling5_end": float(roll5.iloc[-1]) if n >= 2 else None,
        "insufficient": False,
    }


def group_deviations(attendance: pd.DataFrame, classes: pd.DataFrame) -> dict:
    """Per-class / per-grade / per-weekday rates and their deviation from the
    school mean — the honest replacement for invented 'causes'."""
    if attendance.empty:
        return {"classes": [], "grades": [], "weekdays": [], "school_rate": None}
    att = attendance.merge(classes[["id", "name", "grade"]], left_on="classId", right_on="id", how="left")
    att["attended"] = att["status"].isin(ATTENDED)
    school_rate = float(att["attended"].mean())

    def per(group_col: str, label_col: str) -> list[dict]:
        g = att.groupby(group_col)["attended"].agg(["mean", "count"]).reset_index()
        g["deviation_pct_points"] = (g["mean"] - school_rate) * 100
        rows = []
        for _, r in g.sort_values("deviation_pct_points").iterrows():
            rows.append({
                "key": str(r[group_col]),
                "label": str(r[group_col]) if label_col == group_col else str(r[group_col]),
                "rate": round(float(r["mean"]), 4),
                "marks": int(r["count"]),
                "deviation_pct_points": round(float(r["deviation_pct_points"]), 2),
            })
        return rows

    weekday = att.copy()
    weekday["weekday"] = pd.to_datetime(weekday["date"]).dt.day_name()
    wd = weekday.groupby("weekday")["attended"].agg(["mean", "count"]).reset_index()
    wd["deviation_pct_points"] = (wd["mean"] - school_rate) * 100

    return {
        "school_rate": round(school_rate, 4),
        "classes": per("name", "name"),
        "grades": per("grade", "grade"),
        "weekdays": [
            {
                "key": str(r["weekday"]),
                "rate": round(float(r["mean"]), 4),
                "marks": int(r["count"]),
                "deviation_pct_points": round(float(r["deviation_pct_points"]), 2),
            }
            for _, r in wd.sort_values("deviation_pct_points").iterrows()
        ],
    }


def coverage_and_sources(attendance: pd.DataFrame, events: pd.DataFrame, students: pd.DataFrame, anchor_date: str) -> dict:
    """Marking completeness on the anchor day + source mix + late arrivals."""
    active = int((students["active"] == 1).sum()) if not students.empty else 0
    today = attendance[attendance["date"] == anchor_date]
    marked = int(len(today))
    late_events = int(events["late"].fillna(0).astype(bool).sum()) if not events.empty else 0
    late_minutes = (
        float(events.loc[events["late"].fillna(0).astype(bool), "lateMinutes"].dropna().mean())
        if not events.empty and events["late"].fillna(0).astype(bool).any()
        else None
    )
    source_mix = attendance["source"].value_counts(normalize=True).round(4).to_dict() if not attendance.empty else {}
    cv_conf = attendance["confidence"].dropna()
    return {
        "anchor_date": anchor_date,
        "active_students": active,
        "marked_on_anchor": marked,
        "missing_ratio": round(1 - marked / active, 4) if active else None,
        # Whole event log, not the trend window — named for what it counts.
        "late_events_total": late_events,
        "avg_late_minutes": round(late_minutes, 1) if late_minutes is not None else None,
        "source_mix": {str(k): float(v) for k, v in source_mix.items()},
        "cv_confidence_mean": round(float(cv_conf.mean()), 4) if len(cv_conf) else None,
    }


def build(frames: dict, anchor_date: str) -> dict:
    attendance, classes, students = frames["attendance"], frames["classes"], frames["students"]
    active = int((students["active"] == 1).sum()) if not students.empty else 0
    daily = daily_rates(attendance, active)

    # Window statistics use only fully-marked ("complete") days; a day mid
    # roll-call is reported separately, never averaged in.
    complete = daily[~daily["partial"]].reset_index(drop=True) if not daily.empty else daily
    complete_dates = set(complete["date"]) if not complete.empty else set()
    att_complete = attendance[attendance["date"].isin(complete_dates)]
    partials = daily[daily["partial"]]
    in_progress = partials.iloc[-1].to_dict() if len(partials) else None

    return {
        "daily": daily.to_dict("records"),
        "complete_days": int(len(complete)),
        "in_progress_day": (
            {"date": str(in_progress["date"]), "marks": int(in_progress["marks"]),
             "attended": int(in_progress["attended"]), "coverage": round(float(in_progress["coverage"]), 3)}
            if in_progress is not None else None
        ),
        "trend": trend(complete),
        "deviations": group_deviations(att_complete, classes),
        "coverage": coverage_and_sources(attendance, frames["events"], students, anchor_date),
        "_daily_frame": complete,           # forecasting: complete days only
        "_attendance_complete": att_complete,  # anomaly detection: complete days only
    }
