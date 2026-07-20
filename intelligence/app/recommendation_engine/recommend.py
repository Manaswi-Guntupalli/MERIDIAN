"""Recommendation engine — ranked actions generated from evidence.

priority = business_impact x urgency x confidence x affected_factor x operational_risk

Each factor is computed from the insight's own evidence and returned in the
breakdown, so the ranking itself is auditable. Effort is a declared estimate
(config table below) — it is labelled as an estimate, never as model output.
"""
from __future__ import annotations

import math

# Declared effort estimates per action type (minutes of staff time). These are
# planning constants, not intelligence — surfaced as "estimatedEffortMins".
EFFORT_MINS = {"followup_fees": 45, "review_docs": 15, "improve_timetable": 60, "cover_classes": 20, "investigate_attendance": 30, "fix_readers": 15, "contact_families": 25}

URGENCY = {"CRITICAL": 1.0, "WARNING": 0.7, "INFO": 0.4, "SUCCESS": 0.1}


def _affected_factor(affected: int, population: int) -> float:
    """log-scaled share of the affected population, 0..1."""
    if population <= 0 or affected <= 0:
        return 0.05
    share = min(affected / population, 1.0)
    return 0.3 + 0.7 * math.log1p(9 * share) / math.log(10)


def build(candidates: list[dict], population: int) -> list[dict]:
    """candidates: [{id,title,detail,severity,confidence(0-100),impact(0-1),
    affected,risk(0-1),effort_key,action_to,action_label,evidence_ref}]"""
    ranked = []
    for c in candidates:
        urgency = URGENCY.get(c["severity"], 0.4)
        conf = c["confidence"] / 100
        aff = _affected_factor(c["affected"], population)
        risk = c.get("risk", 0.5)
        priority = round(c["impact"] * urgency * conf * aff * risk * 1000)
        ranked.append({
            "id": c["id"],
            "title": c["title"],
            "detail": c["detail"],
            "severity": c["severity"],
            "priorityScore": priority,
            "priorityBreakdown": {
                "businessImpact": round(c["impact"], 3),
                "urgency": urgency,
                "confidence": round(conf, 3),
                "affectedFactor": round(aff, 3),
                "operationalRisk": round(risk, 3),
                "formula": "impact x urgency x confidence x affectedFactor x risk x 1000",
            },
            "affectedCount": c["affected"],
            "estimatedEffortMins": EFFORT_MINS.get(c.get("effort_key", ""), 30),
            "action": {"label": c["action_label"], "to": c["action_to"]},
            "insightId": c.get("evidence_ref"),
        })
    return sorted(ranked, key=lambda r: r["priorityScore"], reverse=True)
