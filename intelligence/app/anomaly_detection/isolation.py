"""Anomaly detection — IsolationForest over real observation matrices.

Scores are normalised to 0..1 (1 = most anomalous in this dataset) and every
anomaly row carries the raw feature values that made it stand out, so it is
traceable. With few observations the model still runs, but the reported
confidence (handled by the inference layer) shrinks with sample size.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest

RANDOM_STATE = 42  # reproducibility — same data in, same anomalies out


def _fit_scores(X: np.ndarray) -> np.ndarray:
    model = IsolationForest(n_estimators=200, random_state=RANDOM_STATE, contamination="auto")
    model.fit(X)
    raw = -model.score_samples(X)  # higher = more anomalous
    lo, hi = float(raw.min()), float(raw.max())
    return (raw - lo) / (hi - lo) if hi > lo else np.zeros_like(raw)


def class_day_anomalies(attendance: pd.DataFrame, classes: pd.DataFrame, top: int = 4) -> list[dict]:
    """Class-days that stand out for the WRONG reason.

    Direction-aware: a perfect-attendance day can be statistically unusual,
    but flagging it only confuses the reader — we surface only days that are
    unusual AND below that class-day population's average rate.
    """
    if attendance.empty or len(attendance) < 20:
        return []
    att = attendance.merge(classes[["id", "name"]], left_on="classId", right_on="id", how="left")
    g = att.groupby(["name", "date"])["status"]
    obs = pd.DataFrame({
        "marks": g.size(),
        "rate": g.apply(lambda s: s.isin(("PRESENT", "LATE")).mean()),
        "late_share": g.apply(lambda s: (s == "LATE").mean()),
        "absent_share": g.apply(lambda s: (s == "ABSENT").mean()),
    }).reset_index()
    if len(obs) < 8:
        return []
    X = obs[["rate", "late_share", "absent_share"]].to_numpy()
    obs["anomaly_score"] = _fit_scores(X)
    mean_rate = float(obs["rate"].mean())
    worst = obs[(obs["anomaly_score"] >= 0.75) & (obs["rate"] < mean_rate)]
    worst = worst.sort_values("anomaly_score", ascending=False).head(top)
    out = []
    for _, r in worst.iterrows():
        absent = int(round(r["absent_share"] * r["marks"]))
        late = int(round(r["late_share"] * r["marks"]))
        parts = [f"{absent} of {int(r['marks'])} absent"]
        if late:
            parts.append(f"{late} late")
        out.append({
            "kind": "ATTENDANCE_CLASS_DAY",
            "entity": f"{r['name']} — {r['date']}",
            "description": f"{', '.join(parts)} ({r['rate']*100:.0f}% attendance vs {mean_rate*100:.0f}% typical) — this class-day sits far outside the school's normal pattern.",
            "anomaly_score": round(float(r["anomaly_score"]), 3),
            "features": {
                "rate": round(float(r["rate"]), 3),
                "late_share": round(float(r["late_share"]), 3),
                "absent_share": round(float(r["absent_share"]), 3),
                "marks": int(r["marks"]),
            },
            "model": "IsolationForest(n_estimators=200, seed=42)",
            "n_observations": int(len(obs)),
        })
    return out


def fee_anomalies(open_fees: pd.DataFrame, students: pd.DataFrame, top: int = 4) -> list[dict]:
    """Open fee accounts whose pattern genuinely differs from the others.

    Honesty guard: if the open accounts are near-uniform (e.g. a seeded
    ledger where everyone owes one of two identical amounts due on the same
    day), IsolationForest's "anomalies" are arbitrary picks — so we report
    none rather than dress noise up as insight.
    """
    if open_fees is None or open_fees.empty or len(open_fees) < 8:
        return []
    df = open_fees.copy()
    df["outstanding_share"] = df["outstanding"] / df["amount"].replace(0, 1)
    distinct_patterns = df[["amount", "outstanding_share", "days_past_due"]].round(2).drop_duplicates()
    if len(distinct_patterns) < max(4, len(df) // 5):
        return []
    X = df[["amount", "outstanding_share", "days_past_due"]].to_numpy(dtype=float)
    X = (X - X.mean(axis=0)) / (X.std(axis=0) + 1e-9)
    df["anomaly_score"] = _fit_scores(X)
    names = dict(zip(students["id"], students["name"])) if not students.empty else {}
    worst = df[df["anomaly_score"] >= 0.8].sort_values("anomaly_score", ascending=False).head(top)
    return [
        {
            "kind": "FEE_ACCOUNT",
            "entity": names.get(r["studentId"], f"student {r['studentId']}"),
            "description": f"₹{r['outstanding']:,.0f} outstanding, {int(r['days_past_due'])} days past due — "
            f"a pattern unlike the other {len(df) - 1} open accounts.",
            "anomaly_score": round(float(r["anomaly_score"]), 3),
            "features": {
                "amount": float(r["amount"]),
                "outstanding": float(r["outstanding"]),
                "days_past_due": int(r["days_past_due"]),
            },
            "model": "IsolationForest(n_estimators=200, seed=42)",
            "n_observations": int(len(df)),
        }
        for _, r in worst.iterrows()
    ]
