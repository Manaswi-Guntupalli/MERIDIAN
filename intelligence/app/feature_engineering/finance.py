"""Finance feature engineering — fee aging, exposure, recovery evidence.

Recovery probabilities are estimated from the school's own cross-sectional
payment outcomes per aging bucket (with Wilson intervals), NOT invented.
When longitudinal Payment history exists, the trained fee-risk model
(training/train_fee_risk.py) takes over; without it we say so explicitly.
"""
from __future__ import annotations

import math
from datetime import datetime

import pandas as pd

BUCKETS = [(0, 30, "0-30d"), (31, 60, "31-60d"), (61, 10_000, "61d+")]


def wilson_interval(successes: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return (0.0, 1.0)
    p = successes / n
    denom = 1 + z**2 / n
    centre = (p + z**2 / (2 * n)) / denom
    margin = (z / denom) * math.sqrt(p * (1 - p) / n + z**2 / (4 * n**2))
    return (max(0.0, centre - margin), min(1.0, centre + margin))


def build(frames: dict, anchor_date: str) -> dict:
    fees: pd.DataFrame = frames["fees"].copy()
    payments: pd.DataFrame = frames["payments"]
    if fees.empty:
        return {"insufficient": True, "n_fees": 0}

    anchor = datetime.fromisoformat(anchor_date)
    fees["outstanding"] = (fees["amount"] - fees["paid"]).clip(lower=0)
    fees["days_past_due"] = fees["dueDate"].map(
        lambda d: max(0, (anchor - datetime.fromisoformat(str(d)[:10])).days)
    )

    open_fees = fees[fees["outstanding"] > 0]
    total_billed = float(fees["amount"].sum())
    total_outstanding = float(open_fees["outstanding"].sum())

    # Aging buckets over OPEN fees.
    buckets = []
    for lo, hi, label in BUCKETS:
        rows = open_fees[(open_fees["days_past_due"] >= lo) & (open_fees["days_past_due"] <= hi)]
        buckets.append({
            "bucket": label,
            "accounts": int(len(rows)),
            "outstanding": round(float(rows["outstanding"].sum()), 2),
        })

    # Cross-sectional recovery evidence: among fees due in each bucket window,
    # what fraction of billed value has actually been collected?
    recovery = []
    for lo, hi, label in BUCKETS:
        rows = fees[(fees["days_past_due"] >= lo) & (fees["days_past_due"] <= hi)]
        billed = float(rows["amount"].sum())
        collected = float(rows["paid"].sum())
        n = int(len(rows))
        paid_full = int((rows["outstanding"] <= 0).sum())
        low, high = wilson_interval(paid_full, n)
        recovery.append({
            "bucket": label,
            "n": n,
            "collected_ratio": round(collected / billed, 4) if billed else None,
            "fully_paid": paid_full,
            "fully_paid_rate": round(paid_full / n, 4) if n else None,
            "fully_paid_wilson95": [round(low, 4), round(high, 4)],
        })

    # Per-guardian behaviour needs longitudinal Payment rows.
    has_history = not payments.empty
    behaviour = None
    if has_history:
        pay = payments.merge(fees[["id", "dueDate", "studentId"]], left_on="feeId", right_on="id")
        pay["delay_days"] = (
            pd.to_datetime(pay["paidAt"]) - pd.to_datetime(pay["dueDate"].str[:10])
        ).dt.days
        per = pay.groupby("studentId")["delay_days"].agg(["mean", "std", "count"]).reset_index()
        behaviour = {
            "students_with_history": int(len(per)),
            "avg_delay_days": round(float(per["mean"].mean()), 1),
            "delay_consistency_std": round(float(per["std"].fillna(0).mean()), 1),
        }

    # Largest open accounts — the traceable "affected entities".
    top_open = (
        open_fees.sort_values("outstanding", ascending=False)
        .head(5)[["studentId", "title", "outstanding", "days_past_due"]]
        .to_dict("records")
    )

    return {
        "insufficient": False,
        "n_fees": int(len(fees)),
        "open_accounts": int(len(open_fees)),
        "total_billed": round(total_billed, 2),
        "total_outstanding": round(total_outstanding, 2),
        "outstanding_ratio": round(total_outstanding / total_billed, 4) if total_billed else None,
        "aging_buckets": buckets,
        "recovery_by_bucket": recovery,
        "payment_history": behaviour,
        "payment_history_available": has_history,
        "top_open_accounts": top_open,
        "_open_fees_frame": open_fees,  # for anomaly/forecast modules
    }
