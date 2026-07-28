"""Health scoring and the recommendation ranking formula."""
from __future__ import annotations

import pytest

from app.recommendation_engine import recommend
from app.scoring import health


def _att(rate: float | None):
    return {"deviations": {"school_rate": rate}, "complete_days": 10,
            "in_progress_day": None}


FIN_OK = {"insufficient": False, "outstanding_ratio": 0.2,
          "total_outstanding": 200.0, "total_billed": 1000.0}
TT_OK = {"insufficient": False, "name": "V1", "score": 90.0}
DOCS_OK = {"insufficient": False, "n_documents": 10, "review_queue": 2,
           "mean_overall_confidence": 0.9}
OPS_OK = {"capture_integrity": 0.95, "enrollment_coverage": 0.8,
          "proxy_attempts": 0}


class TestHealthScore:
    def test_each_category_publishes_its_formula_and_inputs(self):
        out = health.compute(_att(0.93), FIN_OK, TT_OK, DOCS_OK, OPS_OK)
        for name, cat in out["categories"].items():
            assert cat["formula"], f"{name} has no stated formula"
            assert "inputs" in cat
            assert "weight" in cat

    def test_overall_is_within_range(self):
        out = health.compute(_att(0.93), FIN_OK, TT_OK, DOCS_OK, OPS_OK)
        assert 0 <= out["overall"] <= 100

    def test_finance_score_is_the_collected_share(self):
        out = health.compute(_att(0.9), FIN_OK, TT_OK, DOCS_OK, OPS_OK)
        assert out["categories"]["finance"]["score"] == pytest.approx(80.0)

    def test_missing_category_contributes_nothing_and_says_so(self):
        """A school with no fees must not be scored as if finance were zero."""
        out = health.compute(_att(0.9), {"insufficient": True}, TT_OK, DOCS_OK, OPS_OK)
        finance = out["categories"]["finance"]
        assert finance["score"] is None
        assert finance["contribution"] is None
        assert "no fee records" in finance["formula"]

    def test_overall_renormalises_over_categories_that_have_data(self):
        full = health.compute(_att(1.0), FIN_OK, TT_OK, DOCS_OK, OPS_OK)["overall"]
        without_docs = health.compute(
            _att(1.0), FIN_OK, TT_OK, {"insufficient": True}, OPS_OK)["overall"]
        # Dropping a category must not drag the average toward zero.
        assert without_docs >= full - 0.001

    def test_all_categories_missing_yields_no_score_not_zero(self):
        out = health.compute(
            _att(None), {"insufficient": True}, {"insufficient": True},
            {"insufficient": True}, {})
        assert out["overall"] is None

    def test_weights_are_published_and_normalised(self):
        out = health.compute(_att(0.9), FIN_OK, TT_OK, DOCS_OK, OPS_OK)
        assert sum(out["weights"].values()) == pytest.approx(1.0, abs=0.01)

    def test_method_string_explains_the_renormalisation(self):
        out = health.compute(_att(0.9), FIN_OK, TT_OK, DOCS_OK, OPS_OK)
        assert "sum(weights of categories with data)" in out["method"]

    def test_perfect_school_scores_one_hundred(self):
        out = health.compute(
            _att(1.0),
            {"insufficient": False, "outstanding_ratio": 0.0,
             "total_outstanding": 0.0, "total_billed": 1000.0},
            {"insufficient": False, "name": "V1", "score": 100.0},
            {"insufficient": False, "n_documents": 5, "review_queue": 0,
             "mean_overall_confidence": 1.0},
            {"capture_integrity": 1.0, "enrollment_coverage": 1.0, "proxy_attempts": 0},
        )
        assert out["overall"] == pytest.approx(100.0)

    def test_null_outstanding_ratio_is_treated_as_nothing_owed(self):
        fin = {"insufficient": False, "outstanding_ratio": None,
               "total_outstanding": 0.0, "total_billed": 0.0}
        out = health.compute(_att(0.9), fin, TT_OK, DOCS_OK, OPS_OK)
        assert out["categories"]["finance"]["score"] == pytest.approx(100.0)


def _candidate(**over):
    base = dict(id="act-x", title="Do a thing", detail="because", severity="WARNING",
                confidence=80, impact=0.5, affected=10, risk=0.6,
                effort_key="followup_fees", action_to="/x", action_label="Open",
                evidence_ref="ev")
    base.update(over)
    return base


class TestRecommendationRanking:
    def test_no_candidates_yields_no_recommendations(self):
        assert recommend.build([], population=100) == []

    def test_priority_uses_the_published_formula(self):
        out = recommend.build([_candidate()], population=100)[0]
        b = out["priorityBreakdown"]
        expected = round(b["businessImpact"] * b["urgency"] * b["confidence"]
                         * b["affectedFactor"] * b["operationalRisk"] * 1000)
        assert out["priorityScore"] == expected

    def test_formula_string_is_shipped_for_audit(self):
        out = recommend.build([_candidate()], population=100)[0]
        assert out["priorityBreakdown"]["formula"] == (
            "impact x urgency x confidence x affectedFactor x risk x 1000")

    def test_sorted_by_priority_descending(self):
        cands = [
            _candidate(id="low", impact=0.1, severity="INFO"),
            _candidate(id="high", impact=0.9, severity="CRITICAL"),
            _candidate(id="mid", impact=0.5),
        ]
        out = recommend.build(cands, population=100)
        assert [r["id"] for r in out] == ["high", "mid", "low"]

    @pytest.mark.parametrize("severity,expected", [
        ("CRITICAL", 1.0), ("WARNING", 0.7), ("INFO", 0.4), ("SUCCESS", 0.1),
    ])
    def test_urgency_per_severity(self, severity, expected):
        out = recommend.build([_candidate(severity=severity)], population=100)[0]
        assert out["priorityBreakdown"]["urgency"] == expected

    def test_unknown_severity_falls_back_without_crashing(self):
        out = recommend.build([_candidate(severity="BANANA")], population=100)[0]
        assert out["priorityBreakdown"]["urgency"] == 0.4

    def test_affected_factor_grows_with_share_of_the_school(self):
        few = recommend.build([_candidate(affected=1)], population=100)[0]
        many = recommend.build([_candidate(affected=90)], population=100)[0]
        assert (many["priorityBreakdown"]["affectedFactor"]
                > few["priorityBreakdown"]["affectedFactor"])

    def test_affected_factor_is_bounded(self):
        for affected, population in [(0, 100), (100, 100), (500, 100), (1, 1)]:
            out = recommend.build([_candidate(affected=affected)], population=population)[0]
            assert 0.0 <= out["priorityBreakdown"]["affectedFactor"] <= 1.0

    def test_zero_population_does_not_divide_by_zero(self):
        out = recommend.build([_candidate(affected=5)], population=0)[0]
        assert out["priorityBreakdown"]["affectedFactor"] == pytest.approx(0.05)

    def test_effort_is_a_declared_estimate_per_action_type(self):
        out = recommend.build([_candidate(effort_key="followup_fees")], population=100)[0]
        assert out["estimatedEffortMins"] == recommend.EFFORT_MINS["followup_fees"]

    def test_unknown_effort_key_uses_a_safe_default(self):
        out = recommend.build([_candidate(effort_key="nope")], population=100)[0]
        assert out["estimatedEffortMins"] == 30

    def test_action_and_evidence_link_survive_ranking(self):
        out = recommend.build([_candidate()], population=100)[0]
        assert out["action"] == {"label": "Open", "to": "/x"}
        assert out["insightId"] == "ev"

    def test_priority_is_a_non_negative_integer(self):
        for impact in (0.0, 0.25, 1.0):
            out = recommend.build([_candidate(impact=impact)], population=100)[0]
            assert isinstance(out["priorityScore"], int)
            assert out["priorityScore"] >= 0
