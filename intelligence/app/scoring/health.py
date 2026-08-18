"""Health score — a weighted, fully explained combination of category scores.

Every category exposes: its 0-100 score, the exact formula, the period it
describes, the inputs, its weight, and its weighted contribution to the total.
No magic numbers inside the formulas beyond the (configurable) weights.

Two rules keep the headline number meaningful:

  1. A category scores how the school is RUNNING, never how far a rollout has
     got. Face-enrollment coverage used to scale the operations score, so a
     school with flawless attendance capture was capped at 61/100 purely
     because few students had been enrolled yet. Coverage is still reported —
     as an adoption figure, where it belongs.

  2. A category with too little data reports no score rather than a noisy one,
     and drops out of the weighted average (the rest renormalise).

No category is a single-day measure. Attendance averages fully-marked days,
finance is an outstanding balance, timetable is the published solve, and
operations is the integrity of every capture recorded. Scoring the calendar day
alone would read 0 every morning before roll-call — each category therefore
declares the window it actually describes.
"""
from __future__ import annotations

from ..config import MIN_DOCUMENTS_SCORED, health_weights


def _cat(score: float | None, formula: str, window: str, inputs: dict) -> dict:
    """One category. `window` states the period the score describes, so the UI
    never implies a trailing average is today's figure."""
    return {
        "score": round(score, 1) if score is not None else None,
        "formula": formula,
        "window": window,
        "inputs": inputs,
    }


def compute(att: dict, fin: dict, tt: dict, docs: dict, ops: dict) -> dict:
    cats: dict[str, dict] = {}

    school_rate = att["deviations"].get("school_rate")
    complete_days = att.get("complete_days")
    cats["attendance"] = _cat(
        school_rate * 100 if school_rate is not None else None,
        "attendance_rate x 100 over fully-marked school days (days below 50% roll-call coverage are excluded, not averaged in)",
        f"{complete_days} fully-marked school day(s)" if complete_days else "no fully-marked days yet",
        {"attendance_rate": school_rate, "complete_days": complete_days,
         "in_progress_day": att.get("in_progress_day")},
    )

    if not fin.get("insufficient"):
        collected = 1 - (fin["outstanding_ratio"] or 0)
        cats["finance"] = _cat(
            collected * 100,
            "(1 - outstanding/billed) x 100",
            "outstanding balance as it stands now",
            {"outstanding": fin["total_outstanding"], "billed": fin["total_billed"]},
        )
    else:
        cats["finance"] = _cat(None, "no fee records", "outstanding balance as it stands now", {})

    # Staffing is intentionally absent: uncovered classes are a CRITICAL
    # insight/recommendation and teacher overload is a WARNING insight —
    # scoring them again here double-counted the same facts in the gauge.

    cats["timetable"] = _cat(
        tt["score"] if not tt.get("insufficient") else None,
        "active timetable's solver score (0-100) as published by Kairos",
        "the timetable currently published",
        {"timetable": tt.get("name"), "solver_score": tt.get("score")},
    )

    # Extraction quality only means something across a body of documents. Under
    # the threshold the category abstains instead of letting a two-document
    # review queue swing the school's headline score.
    n_docs = 0 if docs.get("insufficient") else docs["n_documents"]
    if n_docs >= MIN_DOCUMENTS_SCORED:
        queue_penalty = docs["review_queue"] / n_docs
        conf = docs["mean_overall_confidence"] or 0
        cats["documents"] = _cat(
            (conf * (1 - queue_penalty)) * 100,
            "mean extraction confidence x (1 - review_queue/total_docs) x 100",
            f"all {n_docs} documents processed so far",
            {"mean_confidence": conf, "review_queue": docs["review_queue"], "total_docs": n_docs},
        )
    else:
        cats["documents"] = _cat(
            None,
            f"not scored: {n_docs} document(s) processed, {MIN_DOCUMENTS_SCORED} needed for a meaningful figure",
            f"all {n_docs} documents processed so far",
            {"total_docs": n_docs, "minimum_required": MIN_DOCUMENTS_SCORED,
             "review_queue": 0 if docs.get("insufficient") else docs["review_queue"]},
        )

    # How cleanly attendance is being captured: verified marks as a share of
    # every mark that could have been verified. Face-enrollment coverage is
    # NOT a factor — how much of the rollout is done is not how well the
    # school is running, and folding it in made a good score unreachable.
    integrity = ops.get("capture_integrity")
    if integrity is not None:
        cats["operations"] = _cat(
            integrity * 100,
            "verified marks / (verified + proxy attempts + unverified QR) x 100",
            "every attendance capture recorded",
            {"capture_integrity": integrity,
             "verified": ops.get("verified", 0),
             "proxy_attempts": ops.get("proxy_attempts", 0),
             "unverified_qr": ops.get("unverified_qr", 0)},
        )
    else:
        cats["operations"] = _cat(
            None, "no attendance captured yet", "every attendance capture recorded", {})

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
            # An abstaining category contributes nothing and, by dividing only
            # by the weights actually used, costs the school nothing either.
            contributions[name] = {**cat, "weight": w, "contribution": None}

    scored = [n for n, c in contributions.items() if c["contribution"] is not None]
    overall = round(total / weight_used, 1) if weight_used else None
    return {
        "overall": overall,
        "weights": weights,
        "categories": contributions,
        "scoredCategories": scored,
        "method": "overall = sum(weight x category score) / sum(weights of categories with data)",
    }
