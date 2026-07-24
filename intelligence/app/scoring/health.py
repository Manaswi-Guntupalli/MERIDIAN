"""Health score — a weighted, fully explained combination of category scores.

Every category exposes: its 0-100 score, the exact formula, the inputs, its
weight, and its weighted contribution to the total. No magic numbers inside
the formulas beyond the (configurable) weights themselves.
"""
from __future__ import annotations

from ..config import health_weights


def _cat(score: float | None, formula: str, inputs: dict) -> dict:
    return {"score": round(score, 1) if score is not None else None, "formula": formula, "inputs": inputs}


def compute(att: dict, fin: dict, tt: dict, docs: dict, ops: dict) -> dict:
    cats: dict[str, dict] = {}

    school_rate = att["deviations"].get("school_rate")
    cats["attendance"] = _cat(
        school_rate * 100 if school_rate is not None else None,
        "attendance_rate x 100 over fully-marked school days (days below 50% roll-call coverage are excluded, not averaged in)",
        {"attendance_rate": school_rate, "complete_days": att.get("complete_days"),
         "in_progress_day": att.get("in_progress_day")},
    )

    if not fin.get("insufficient"):
        collected = 1 - (fin["outstanding_ratio"] or 0)
        cats["finance"] = _cat(collected * 100, "(1 - outstanding/billed) x 100", {
            "outstanding": fin["total_outstanding"], "billed": fin["total_billed"],
        })
    else:
        cats["finance"] = _cat(None, "no fee records", {})

    # Staffing is intentionally absent: uncovered classes are a CRITICAL
    # insight/recommendation and teacher overload is a WARNING insight —
    # scoring them again here double-counted the same facts in the gauge.

    cats["timetable"] = _cat(
        tt["score"] if not tt.get("insufficient") else None,
        "active timetable's solver score (0-100) as published by Kairos",
        {"timetable": tt.get("name"), "solver_score": tt.get("score")},
    )

    if not docs.get("insufficient"):
        n = docs["n_documents"]
        queue_penalty = docs["review_queue"] / n if n else 0
        conf = docs["mean_overall_confidence"] or 0
        cats["documents"] = _cat(
            (conf * (1 - queue_penalty)) * 100,
            "mean extraction confidence x (1 - review_queue/total_docs) x 100",
            {"mean_confidence": conf, "review_queue": docs["review_queue"], "total_docs": n},
        )
    else:
        cats["documents"] = _cat(None, "no documents processed", {})

    # Attendance capture integrity — clean marks vs proxy/unverified-QR —
    # scaled by how much of the school the primary (face) method can reach.
    integrity = ops.get("capture_integrity")
    coverage = ops.get("enrollment_coverage")
    if integrity is not None:
        cov_factor = 0.6 + 0.4 * coverage if coverage is not None else 1.0
        cats["operations"] = _cat(
            integrity * cov_factor * 100,
            "capture integrity x (0.6 + 0.4 x face-enrollment coverage) x 100",
            {"capture_integrity": integrity, "enrollment_coverage": coverage, "proxy_attempts": ops.get("proxy_attempts", 0)},
        )
    else:
        cats["operations"] = _cat(None, "no attendance captured yet", {})

    weights = health_weights()
    total, weight_used = 0.0, 0.0
    contributions = {}
    for name, cat in cats.items():
        w = weights.get(name, 0)
        if cat["score"] is not None:
            total += w * cat["score"]
            weight_used += w
            contributions[name] = {**cat, "weight": w, "contribution": round(w * cat["score"], 2)}
        else:
            contributions[name] = {**cat, "weight": w, "contribution": None}

    overall = round(total / weight_used, 1) if weight_used else None
    return {
        "overall": overall,
        "weights": weights,
        "categories": contributions,
        "method": "overall = sum(weight x category score) / sum(weights of categories with data)",
    }
