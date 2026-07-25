"""Per-student early-warning features — the at-risk index.

HONESTY CONTRACT: every factor below is a direct observation from records
(attendance marks, fee ledger). The combination into one index uses DECLARED
weights — it is a transparent heuristic, not a trained model, because no
labelled dropout/failure outcomes exist in this database to train on (the
same refusal recorded in training/train_fee_risk.py). The formula ships with
every payload so the dashboard can show the arithmetic. Grade data does not
exist in the schema, so "grade slopes" are NOT part of the index — absent
data is stated, never invented.
"""
from __future__ import annotations

from datetime import datetime

from ..confidence import build as conf_build

# Declared weights and cutoffs — surfaced verbatim in the payload.
WEIGHTS = {"attendance_deficit": 0.45, "fee_overdue": 0.25, "late_share": 0.15, "attendance_trend": 0.15}
BAND_HIGH = 0.55
BAND_ELEVATED = 0.30
FORMULA = (
    "risk = 0.45 x attendance_deficit + 0.25 x fee_overdue + 0.15 x late_share + 0.15 x attendance_trend; "
    "attendance_deficit = clip((90% - rate)/40pts), fee_overdue = clip(days_overdue/60d), "
    "late_share = clip(4 x lates/marks), attendance_trend = clip(-delta/15pts, declines only)"
)


def _clip(x: float) -> float:
    return min(max(x, 0.0), 1.0)


def build(frames: dict, anchor: str) -> dict:
    att = frames["attendance"]
    students = frames["students"]
    classes = frames["classes"]
    fees = frames["fees"]

    active = students[students["active"] == 1] if not students.empty else students
    if att.empty or active.empty:
        return {"available": False, "reason": "No attendance records yet — the index needs marked days.", "students": [], "n_flagged": 0}

    # Only days where most of the school is marked are comparable — the same
    # representativeness rule the Node dashboard applies.
    marks_per_day = att.groupby("date").size()
    complete_days = sorted(d for d in marks_per_day.index if marks_per_day[d] >= 0.5 * len(active))
    if len(complete_days) < 4:
        return {
            "available": False,
            "reason": f"Only {len(complete_days)} fully-marked school day(s) — at least 4 needed for a defensible index.",
            "students": [], "n_flagged": 0,
        }

    att_c = att[att["date"].isin(complete_days)]
    half = len(complete_days) // 2
    first_days, second_days = set(complete_days[:half]), set(complete_days[half:])
    anchor_dt = datetime.strptime(anchor, "%Y-%m-%d")

    class_names = dict(zip(classes["id"], classes["name"])) if not classes.empty else {}

    # Open-fee aging per student. Past-due money is tracked separately from
    # money that is merely billed: only the former is "overdue", and reporting
    # one total next to an overdue age reads as if all of it were late.
    fee_days: dict[str, float] = {}
    fee_due: dict[str, float] = {}
    fee_past_due: dict[str, float] = {}
    if not fees.empty:
        for _, f in fees.iterrows():
            due = float(f["amount"]) - float(f["paid"])
            if due <= 0:
                continue
            try:
                overdue = (anchor_dt - datetime.strptime(str(f["dueDate"])[:10], "%Y-%m-%d")).days
            except ValueError:
                overdue = 0
            sid = f["studentId"]
            fee_due[sid] = fee_due.get(sid, 0.0) + due
            if overdue > 0:
                fee_past_due[sid] = fee_past_due.get(sid, 0.0) + due
                fee_days[sid] = max(fee_days.get(sid, 0.0), float(overdue))

    rows = []
    for _, s in active.iterrows():
        sid = s["id"]
        mine = att_c[att_c["studentId"] == sid]
        n = len(mine)
        if n == 0:
            continue
        present = len(mine[mine["status"].isin(["PRESENT", "LATE"])])
        rate = present / n
        lates = len(mine[mine["status"] == "LATE"])
        late_share = lates / n

        # Trend: first-half vs second-half rate, only when both halves have
        # enough of the student's own marks to mean something.
        f_half = mine[mine["date"].isin(first_days)]
        s_half = mine[mine["date"].isin(second_days)]
        delta = None
        if len(f_half) >= 2 and len(s_half) >= 2:
            r1 = len(f_half[f_half["status"].isin(["PRESENT", "LATE"])]) / len(f_half)
            r2 = len(s_half[s_half["status"].isin(["PRESENT", "LATE"])]) / len(s_half)
            delta = r2 - r1

        f_att = _clip((0.90 - rate) / 0.40)
        f_fee = _clip(fee_days.get(sid, 0.0) / 60.0)
        f_late = _clip(4.0 * late_share)
        f_trend = _clip(-(delta or 0.0) / 0.15) if delta is not None and delta < 0 else 0.0

        risk = (
            WEIGHTS["attendance_deficit"] * f_att
            + WEIGHTS["fee_overdue"] * f_fee
            + WEIGHTS["late_share"] * f_late
            + WEIGHTS["attendance_trend"] * f_trend
        )
        if risk < BAND_ELEVATED:
            continue

        reasons = []
        if f_att > 0:
            reasons.append(f"attendance {rate*100:.0f}% over {n} marked day(s)")
        if f_fee > 0:
            past_due = fee_past_due.get(sid, 0.0)
            not_yet_due = fee_due.get(sid, 0.0) - past_due
            reasons.append(
                f"fees ₹{past_due:,.0f} past due, oldest {fee_days.get(sid, 0):.0f}d"
                + (f" (plus ₹{not_yet_due:,.0f} not yet due)" if not_yet_due > 0 else "")
            )
        if f_late > 0:
            reasons.append(f"late {lates}x in {n} day(s)")
        if f_trend > 0:
            reasons.append(f"attendance fell {abs(delta or 0)*100:.0f} pts second half vs first")

        completeness = n / len(complete_days)
        conf = conf_build(
            1.0, completeness, n,
            "Factors are direct record observations; the index weighting is declared, not learned",
        )
        rows.append({
            "studentId": sid,
            "name": s["name"],
            "className": class_names.get(s["classId"], None),
            "riskScore": round(risk * 100),
            "band": "HIGH" if risk >= BAND_HIGH else "ELEVATED",
            "factors": {
                "attendanceRate": round(rate, 3),
                "attendanceDeficit": round(f_att, 3),
                "feeOverdueDays": fee_days.get(sid, 0.0),
                "feesDue": round(fee_due.get(sid, 0.0)),          # all open fees
                "feesPastDue": round(fee_past_due.get(sid, 0.0)),  # the overdue slice only
                "lateShare": round(late_share, 3),
                "trendDelta": round(delta, 3) if delta is not None else None,
            },
            "reasons": reasons,
            "confidence": conf.as_dict(),
        })

    rows.sort(key=lambda r: r["riskScore"], reverse=True)
    return {
        "available": True,
        "method": "Transparent weighted index over observed records (declared weights — no trained model: no labelled outcomes exist). Grades are not in the schema and are therefore not a factor.",
        "formula": FORMULA,
        "weights": WEIGHTS,
        "bands": {"HIGH": BAND_HIGH, "ELEVATED": BAND_ELEVATED},
        "window": {"days": len(complete_days), "from": complete_days[0], "to": complete_days[-1]},
        "n_flagged": len(rows),
        "n_high": sum(1 for r in rows if r["band"] == "HIGH"),
        "students": rows[:12],
    }
