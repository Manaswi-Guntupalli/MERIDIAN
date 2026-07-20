"""Engine configuration — DB location and health-score weights.

Weights are configurable (env var HEALTH_WEIGHTS as JSON) and every category's
contribution is reported back to the caller, per the auditability requirement.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

# The dev database lives next to the Prisma schema. Override with MERIDIAN_DB.
_DEFAULT_DB = Path(__file__).resolve().parents[2] / "server" / "prisma" / "meridian.db"
DB_PATH = Path(os.environ.get("MERIDIAN_DB", str(_DEFAULT_DB)))

# Staffing is deliberately NOT a health category: uncovered classes and
# overloaded teachers already surface as insights/recommendations, and
# double-counting them in the gauge muddied the headline number.
_DEFAULT_WEIGHTS = {
    "attendance": 0.35,
    "finance": 0.28,
    "timetable": 0.20,
    "documents": 0.08,
    "operations": 0.09,
}


def health_weights() -> dict[str, float]:
    raw = os.environ.get("HEALTH_WEIGHTS")
    if not raw:
        return dict(_DEFAULT_WEIGHTS)
    try:
        parsed = {k: float(v) for k, v in json.loads(raw).items() if k in _DEFAULT_WEIGHTS}
    except (ValueError, TypeError):
        return dict(_DEFAULT_WEIGHTS)
    weights = {**_DEFAULT_WEIGHTS, **parsed}
    total = sum(weights.values()) or 1.0
    return {k: v / total for k, v in weights.items()}


MODELS_DIR = Path(__file__).resolve().parents[1] / "models"
MODELS_DIR.mkdir(exist_ok=True)

ENGINE_VERSION = "1.0.0"
