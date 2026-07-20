"""Document (Lumen) feature engineering — review queue health from real
extraction confidences and field states."""
from __future__ import annotations

from datetime import datetime, timezone

import pandas as pd


def build(frames: dict, anchor_date: str) -> dict:
    docs: pd.DataFrame = frames["documents"]
    fields: pd.DataFrame = frames["doc_fields"]
    if docs.empty:
        return {"insufficient": True, "n_documents": 0}

    review = docs[docs["status"] == "REVIEW"]
    now = datetime.now(timezone.utc)

    queue_ages = []
    for _, d in review.iterrows():
        try:
            created = pd.to_datetime(d["createdAt"], utc=True)
            queue_ages.append((now - created).total_seconds() / 3600)
        except (ValueError, TypeError):
            pass

    review_fields = fields[fields["status"] == "REVIEW"] if not fields.empty else fields
    missing_required = (
        int(((fields["status"] == "MISSING") & (fields["required"] == 1)).sum()) if not fields.empty else 0
    )

    return {
        "insufficient": False,
        "n_documents": int(len(docs)),
        "review_queue": int(len(review)),
        "verified": int((docs["status"].isin(["VERIFIED", "COMMITTED"])).sum()),
        "failed": int((docs["status"] == "FAILED").sum()),
        "mean_overall_confidence": round(float(docs["overallConfidence"].mean()), 4),
        "review_mean_confidence": round(float(review["overallConfidence"].mean()), 4) if len(review) else None,
        "queue_age_hours_max": round(max(queue_ages), 1) if queue_ages else None,
        "fields_awaiting_review": int(len(review_fields)) if review_fields is not None else 0,
        "missing_required_fields": missing_required,
        "corrections_total": int(docs["correctionCount"].sum()),
        "correction_rate_per_doc": round(float(docs["correctionCount"].mean()), 2),
    }
