"""Confidence framework — the arithmetic behind every "why 74%?" on the UI."""
from __future__ import annotations

import pytest

from app.confidence import (
    Confidence,
    build,
    insufficient,
    observed_fact,
    sample_factor,
)


class TestSampleFactor:
    def test_documented_shrinkage_points(self):
        # The docstring promises these exact values; the UI quotes them.
        assert sample_factor(8) == pytest.approx(0.5)
        assert sample_factor(24) == pytest.approx(0.75)
        assert sample_factor(72) == pytest.approx(0.9)

    def test_zero_observations_gives_no_confidence(self):
        assert sample_factor(0) == 0.0

    def test_negative_n_does_not_produce_a_positive_factor(self):
        # Guards against a negative count sneaking through and inflating a score.
        assert sample_factor(-5) <= 0.0

    def test_is_monotonic_in_n(self):
        values = [sample_factor(n) for n in range(1, 50)]
        assert values == sorted(values)

    def test_never_reaches_one(self):
        assert sample_factor(10_000) < 1.0

    def test_k_controls_how_fast_confidence_is_earned(self):
        assert sample_factor(8, k=8) == pytest.approx(0.5)
        assert sample_factor(8, k=2) == pytest.approx(0.8)


class TestBuild:
    def test_multiplies_the_three_components(self):
        c = build(signal=0.8, completeness=0.5, n=8, basis="test")
        # 100 * 0.8 * 0.5 * 0.5 = 20
        assert c.value == 20

    def test_components_are_reported_for_audit(self):
        c = build(signal=0.8, completeness=0.5, n=8, basis="test")
        assert c.components["signalStrength"] == pytest.approx(0.8)
        assert c.components["dataCompleteness"] == pytest.approx(0.5)
        assert c.components["sampleFactor"] == pytest.approx(0.5)
        assert c.components["n"] == 8

    def test_explanation_contains_the_arithmetic(self):
        c = build(signal=0.8, completeness=0.5, n=8, basis="Trend signal")
        assert "Trend signal" in c.explanation
        assert "0.80" in c.explanation and "0.50" in c.explanation
        assert str(c.value) in c.explanation

    @pytest.mark.parametrize("signal", [-1.0, -0.001])
    def test_negative_signal_clamps_to_zero(self, signal):
        assert build(signal, 1.0, 100, "x").value == 0

    @pytest.mark.parametrize("signal", [1.5, 99.0])
    def test_signal_above_one_clamps_to_one(self, signal):
        # Without clamping a p-value glitch could report >100% confidence.
        assert build(signal, 1.0, 10_000, "x").value <= 100

    def test_completeness_is_clamped_both_ways(self):
        assert build(1.0, -2.0, 100, "x").value == 0
        assert build(1.0, 5.0, 10_000, "x").value <= 100

    def test_zero_sample_yields_zero_regardless_of_signal(self):
        assert build(1.0, 1.0, 0, "x").value == 0

    def test_value_is_bounded_to_percentage_range(self):
        for signal in (0.0, 0.3, 1.0):
            for completeness in (0.0, 0.6, 1.0):
                for n in (0, 1, 50, 5000):
                    assert 0 <= build(signal, completeness, n, "x").value <= 100

    def test_as_dict_shape_matches_the_api_contract(self):
        d = build(0.5, 0.5, 10, "x").as_dict()
        assert set(d) == {"value", "explanation", "components"}


class TestObservedFact:
    def test_a_database_count_is_full_confidence(self):
        c = observed_fact(42, "fee ledger aging")
        assert c.value == 100

    def test_explains_that_it_is_not_a_model_output(self):
        c = observed_fact(42, "fee ledger aging")
        assert "fact" in c.explanation.lower()
        assert "fee ledger aging" in c.explanation

    def test_zero_rows_is_still_a_fact(self):
        # "There are 0 documents in review" is as true as any other count.
        assert observed_fact(0, "documents").value == 100


class TestInsufficient:
    def test_reports_zero_and_says_why(self):
        c = insufficient("attendance trend", n=2, needed=4)
        assert c.value == 0
        assert "2" in c.explanation and "4" in c.explanation

    def test_is_a_confidence_instance(self):
        assert isinstance(insufficient("x", 0, 1), Confidence)
