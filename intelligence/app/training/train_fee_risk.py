"""Train the fee late-payment risk model (LogisticRegression, interpretable).

Run:  python -m app.training.train_fee_risk <schoolId>

HONESTY GATE: supervised training needs labelled longitudinal history —
Payment rows that show whether past fees were settled on time. If fewer than
MIN_LABELLED examples exist, this script REFUSES to train and records that
fact; inference then uses transparent aging-bucket statistics and says so.
A model trained on circular labels (predicting current status from current
status) would be exactly the fake AI this engine exists to eliminate.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone

import joblib
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import train_test_split

from ..config import MODELS_DIR
from ..db import load_school_frames

MIN_LABELLED = 60


def build_training_frame(frames: dict) -> pd.DataFrame | None:
    fees, payments = frames["fees"], frames["payments"]
    if payments.empty:
        return None
    pay = payments.merge(fees[["id", "dueDate", "studentId", "amount"]], left_on="feeId", right_on="id")
    pay["delay_days"] = (pd.to_datetime(pay["paidAt"]) - pd.to_datetime(pay["dueDate"].str[:10])).dt.days
    pay["late"] = (pay["delay_days"] > 0).astype(int)
    # Features per settled fee: amount + that guardian's PRIOR behaviour.
    pay = pay.sort_values("paidAt")
    pay["prior_late_rate"] = (
        pay.groupby("studentId")["late"].transform(lambda s: s.shift().expanding().mean()).fillna(0.5)
    )
    return pay[["amount", "prior_late_rate", "late"]].dropna()


def main(school_id: str) -> None:
    frames = load_school_frames(school_id)
    df = build_training_frame(frames)
    marker = MODELS_DIR / "fee_risk_status.json"

    if df is None or len(df) < MIN_LABELLED:
        n = 0 if df is None else len(df)
        status = {
            "trained": False,
            "reason": f"Insufficient labelled payment history: {n} settled payments with timestamps, {MIN_LABELLED} required.",
            "checkedAt": datetime.now(timezone.utc).isoformat(),
        }
        marker.write_text(json.dumps(status, indent=2))
        print(json.dumps(status, indent=2))
        return

    X, y = df[["amount", "prior_late_rate"]], df["late"]
    X_tr, X_te, y_tr, y_te = train_test_split(X, y, test_size=0.25, random_state=42, stratify=y)
    model = LogisticRegression(max_iter=1000)
    model.fit(X_tr, y_tr)
    auc = roc_auc_score(y_te, model.predict_proba(X_te)[:, 1])

    joblib.dump(model, MODELS_DIR / "fee_risk.joblib")
    status = {
        "trained": True,
        "model": "LogisticRegression(amount, prior_late_rate)",
        "holdout_auc": round(float(auc), 3),
        "n_train": int(len(X_tr)),
        "n_test": int(len(X_te)),
        "trainedAt": datetime.now(timezone.utc).isoformat(),
    }
    marker.write_text(json.dumps(status, indent=2))
    print(json.dumps(status, indent=2))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("usage: python -m app.training.train_fee_risk <schoolId>")
    main(sys.argv[1])
