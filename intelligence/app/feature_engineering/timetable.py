"""Timetable feature engineering — reads the ACTIVE solver output.

The Kairos solver already writes an honest health breakdown (healthString);
we surface it rather than re-deriving, and add utilization/idle analysis
computed from the actual slots.
"""
from __future__ import annotations

import json

import pandas as pd


def build(frames: dict, anchor_date: str) -> dict:
    tt: pd.DataFrame = frames["timetable"]
    slots: pd.DataFrame = frames["slots"]
    if tt.empty:
        return {"insufficient": True, "reason": "No active timetable"}

    row = tt.iloc[0]
    health = None
    if row.get("healthString"):
        try:
            health = json.loads(row["healthString"])
        except (json.JSONDecodeError, TypeError):
            health = None

    out: dict = {
        "insufficient": False,
        "name": str(row["name"]),
        "score": float(row["score"]),
        "solver_health": health,
        "updated_at": str(row["updatedAt"]),
    }

    if not slots.empty:
        days = int(slots["day"].max()) + 1
        periods = int(slots["period"].max()) + 1
        # Denominator is the rooms this timetable actually books, not the
        # school's room inventory — a room the solver never touches cannot pull
        # this number down, so it reads as "how densely are the rooms in use
        # booked", not "how much of the estate is used".
        rooms = slots["roomId"].nunique()
        out["room_utilization"] = round(len(slots[slots["roomId"].notna()]) / (rooms * days * periods), 4) if rooms else None
        out["room_utilization_basis"] = f"{rooms} room(s) booked by this timetable x {days} days x {periods} periods"

        # Teacher idle gaps: for each teacher-day, periods between first and
        # last assignment that are unassigned.
        gaps = 0
        for (_, _), grp in slots.groupby(["teacherId", "day"]):
            ps = sorted(grp["period"].tolist())
            if len(ps) >= 2:
                gaps += (ps[-1] - ps[0] + 1) - len(ps)
        out["teacher_idle_gaps_per_week"] = int(gaps)

        per_teacher_daily = slots.groupby(["teacherId", "day"]).size()
        out["max_daily_periods_observed"] = int(per_teacher_daily.max())
        out["avg_daily_periods"] = round(float(per_teacher_daily.mean()), 2)
        out["slots_total"] = int(len(slots))
    return out
