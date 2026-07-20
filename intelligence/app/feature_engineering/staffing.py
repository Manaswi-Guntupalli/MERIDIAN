"""Staffing feature engineering — workload, absence history, cover capacity."""
from __future__ import annotations

import pandas as pd


def build(frames: dict, anchor_date: str) -> dict:
    teachers: pd.DataFrame = frames["teachers"]
    absences: pd.DataFrame = frames["absences"]
    subs: pd.DataFrame = frames["substitutions"]
    if teachers.empty:
        return {"insufficient": True}

    teachers = teachers.copy()
    teachers["load_ratio"] = teachers["weeklyHours"] / teachers["maxHours"].replace(0, 1)

    overloaded = teachers[teachers["load_ratio"] >= 0.95]
    near_cap = teachers[(teachers["load_ratio"] >= 0.85) & (teachers["load_ratio"] < 0.95)]
    spare = teachers[teachers["load_ratio"] <= 0.7]

    # Absence history: rate per teacher-school-day in the observed window.
    school_days = frames["attendance"]["date"].nunique() if not frames["attendance"].empty else 0
    n_teachers = len(teachers)
    absence_days = int(len(absences))
    exposure = school_days * n_teachers
    absence_rate = absence_days / exposure if exposure else None

    uncovered_today = 0
    if not absences.empty:
        today = absences[absences["date"] == anchor_date]
        covered_ids = set(subs["absenceId"]) if not subs.empty else set()
        uncovered_today = int((~today["id"].isin(covered_ids)).sum())

    return {
        "insufficient": False,
        "n_teachers": n_teachers,
        "avg_load_ratio": round(float(teachers["load_ratio"].mean()), 4),
        "overloaded": teachers.loc[teachers["load_ratio"] >= 0.95, ["name", "weeklyHours", "maxHours"]]
        .assign(load_ratio=lambda d: (d["weeklyHours"] / d["maxHours"]).round(3))
        .to_dict("records"),
        "overloaded_count": int(len(overloaded)),
        "near_cap_count": int(len(near_cap)),
        "spare_capacity_count": int(len(spare)),
        "absence_days_window": absence_days,
        "school_days_window": school_days,
        "teacher_day_exposure": exposure,
        "absence_rate": round(absence_rate, 5) if absence_rate is not None else None,
        "uncovered_today": uncovered_today,
    }
