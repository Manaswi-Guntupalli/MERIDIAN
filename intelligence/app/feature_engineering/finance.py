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

# Aging bands over fees that are ACTUALLY past due. Fees not yet due are a
# separate row, never folded into the youngest band: a fee due next month is
# an open receivable, not an aged one.
BUCKETS = [(1, 30, "1-30d"), (31, 60, "31-60d"), (61, 10_000, "61d+")]
NOT_YET_DUE = "Not yet due"


def wilson_interval(successes: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return (0.0, 1.0)
    p = successes / n
    denom = 1 + z**2 / n
    centre = (p + z**2 / (2 * n)) / denom
    margin = (z / denom) * math.sqrt(p * (1 - p) / n + z**2 / (4 * n**2))
    return (max(0.0, centre - margin), min(1.0, centre + margin))


def _partition(frame: pd.DataFrame):
    """Yield (label, rows) for the not-yet-due set plus each past-due band.

    Buckets and recovery rows are both built from this, so the two lists stay
    index-aligned — forecasting zips them together.
    """
    yield NOT_YET_DUE, frame[~frame["past_due"]]
    past = frame[frame["past_due"]]
    for lo, hi, label in BUCKETS:
        yield label, past[(past["days_past_due"] >= lo) & (past["days_past_due"] <= hi)]


def build(frames: dict, anchor_date: str) -> dict:
    fees: pd.DataFrame = frames["fees"].copy()
    payments: pd.DataFrame = frames["payments"]
    if fees.empty:
        return {"insufficient": True, "n_fees": 0}

    anchor = datetime.fromisoformat(anchor_date)
    fees["outstanding"] = (fees["amount"] - fees["paid"]).clip(lower=0)
    # Signed distance from the due date — negative means the fee is not due
    # yet. Clamping this at 0 (the previous behaviour) parked every future-dated
    # fee in the youngest aging band, which is what made "overdue" silently mean
    # "31+ days past due" and under-reported the real past-due count.
    fees["days_from_due"] = fees["dueDate"].map(
        lambda d: (anchor - datetime.fromisoformat(str(d)[:10])).days
    )
    # Same rule as the API: past its due date and not fully paid.
    fees["past_due"] = fees["days_from_due"] > 0
    # Clamped view for anomaly features and per-account text, where "days past
    # due" must not read negative.
    fees["days_past_due"] = fees["days_from_due"].clip(lower=0)

    open_fees = fees[fees["outstanding"] > 0]
    overdue_fees = open_fees[open_fees["past_due"]]
    total_billed = float(fees["amount"].sum())
    total_outstanding = float(open_fees["outstanding"].sum())

    # Aging buckets over OPEN fees. "accounts" counts distinct students, the
    # same unit the fees API and dashboard report — one student with three
    # unpaid fees is one account to chase, not three.
    buckets = [
        {
            "bucket": label,
            "accounts": int(rows["studentId"].nunique()),
            "fee_records": int(len(rows)),
            "outstanding": round(float(rows["outstanding"].sum()), 2),
        }
        for label, rows in _partition(open_fees)
    ]

    # Cross-sectional recovery evidence: among fees due in each bucket window,
    # what fraction of billed value has actually been collected?
    recovery = []
    for label, rows in _partition(fees):
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
        # Accounts = distinct students; records = individual fee rows.
        "open_accounts": int(open_fees["studentId"].nunique()),
        "open_fee_records": int(len(open_fees)),
        "overdue_accounts": int(overdue_fees["studentId"].nunique()),
        "overdue_fee_records": int(len(overdue_fees)),
        "overdue_outstanding": round(float(overdue_fees["outstanding"].sum()), 2),
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
