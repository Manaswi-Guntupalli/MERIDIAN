"""Confidence framework — every confidence value in the system is COMPUTED.

A confidence is always returned with its components and a human-readable
explanation, so the dashboard can answer "why 74%?" with arithmetic, not
vibes. Components multiply because each is a probability-like discount:

    confidence = 100 x signal_strength x data_completeness x sample_factor

- signal_strength: how decisive the statistic/model output is
  (e.g. 1 - p_value for a trend, probability margin for a classifier,
  interval narrowness for a forecast).
- data_completeness: fraction of expected records that actually exist.
- sample_factor: n / (n + k) shrinkage — small samples honestly cap
  confidence no matter how clean the signal looks.
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Confidence:
    value: int
    explanation: str
    components: dict[str, float] = field(default_factory=dict)

    def as_dict(self) -> dict:
        return {"value": self.value, "explanation": self.explanation, "components": self.components}


def sample_factor(n: int, k: int = 8) -> float:
    """n/(n+k) shrinkage: 8 obs -> 0.5, 24 obs -> 0.75, 72 obs -> 0.9."""
    return n / (n + k) if n > 0 else 0.0


def build(signal: float, completeness: float, n: int, basis: str, k: int = 8) -> Confidence:
    signal = min(max(signal, 0.0), 1.0)
    completeness = min(max(completeness, 0.0), 1.0)
    sf = sample_factor(n, k)
    value = round(100 * signal * completeness * sf)
    explanation = (
        f"{basis}. Signal strength {signal:.2f} x data completeness {completeness:.2f} "
        f"x sample factor {sf:.2f} (n={n}) = {value}%."
    )
    return Confidence(value=value, explanation=explanation, components={
        "signalStrength": round(signal, 3),
        "dataCompleteness": round(completeness, 3),
        "sampleFactor": round(sf, 3),
        "n": n,
    })


def observed_fact(n: int, what: str) -> Confidence:
    """Direct database counts are facts, not predictions."""
    return Confidence(
        value=100,
        explanation=f"Direct database count ({what}, n={n}) — a fact, not a model output.",
        components={"kind": 1.0, "n": n},
    )


def insufficient(what: str, n: int, needed: int) -> Confidence:
    return Confidence(
        value=0,
        explanation=f"Insufficient evidence: {what} has {n} observation(s); at least {needed} needed.",
        components={"n": n, "needed": needed},
    )
