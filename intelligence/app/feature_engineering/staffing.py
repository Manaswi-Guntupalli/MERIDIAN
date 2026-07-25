"""Staffing feature engineering — workload, absence history, cover capacity."""
from __future__ import annotations

from datetime import datetime

import pandas as pd


def _day_index(date: str) -> int:
    """Calendar date ➜ timetable day index, matching Kairos (Mon=0 … Sun=6)."""
    return datetime.strptime(str(date)[:10], "%Y-%m-%d").weekday()


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
    uncovered_classes: list[str] = []
    students_affected: int | None = None
    if not absences.empty:
        today = absences[absences["date"] == anchor_date]
        # Only an ACCEPTED substitution is cover — a declined or pending one
        # leaves the period unstaffed, and the insight says "no accepted
        # substitution", so the filter has to say the same thing.
        covered_ids = (
            set(subs.loc[subs["accepted"].astype(bool), "absenceId"]) if not subs.empty else set()
        )
        uncovered = today[~today["id"].isin(covered_ids)]
        uncovered_today = int(len(uncovered))

        # Who is actually affected: the classes those teachers were timetabled
        # to teach on this weekday, and the students enrolled in them. Derived
        # from real slots and rosters rather than assuming a class size.
        slots, students = frames["slots"], frames["students"]
        if uncovered_today and not slots.empty and not students.empty:
            day_idx = _day_index(anchor_date)
            mine = slots[(slots["day"] == day_idx) & (slots["teacherId"].isin(uncovered["teacherId"]))]
            uncovered_classes = sorted({c for c in mine["classId"].dropna()})
            if uncovered_classes:
                active = students[students["active"] == 1]
                students_affected = int(active["classId"].isin(uncovered_classes).sum())

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
        "uncovered_classes_today": len(uncovered_classes),
        # None when there is no timetable/roster to derive it from — the engine
        # then reports the absence count rather than inventing a headcount.
        "students_affected_today": students_affected,
    }
