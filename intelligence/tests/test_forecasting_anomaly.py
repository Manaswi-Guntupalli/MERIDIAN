"""Forecasting (intervals, not naked numbers) and anomaly detection."""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from app.anomaly_detection import isolation
from app.feature_engineering import attendance
from app.forecasting import forecast
from tests.conftest import (
    attendance_frame,
    classes_frame,
    school_days,
    students_frame,
)


class TestAttendanceTomorrow:
    def test_too_little_history_declines_to_predict(self):
        students = students_frame(5)
        daily = attendance.daily_rates(attendance_frame(students, school_days(2)), 5)
        assert forecast.attendance_tomorrow(daily)["available"] is False

    def test_prediction_carries_an_interval_and_a_model_name(self):
        students = students_frame(10)
        daily = attendance.daily_rates(attendance_frame(students, school_days(10)), 10)
        out = forecast.attendance_tomorrow(daily)
        assert out["available"] is True
        assert "model" in out and out["model"]
        assert len(out["interval80"]) == 2

    def test_interval_brackets_the_point_estimate(self):
        students = students_frame(10)
        dates = school_days(10)
        rows = []
        for i, date in enumerate(dates):
            present = 10 - (i % 3)
            rows.append(attendance_frame(students.head(present), [date], "PRESENT"))
            if present < 10:
                rows.append(attendance_frame(students.tail(10 - present), [date], "ABSENT"))
        daily = attendance.daily_rates(pd.concat(rows), 10)
        out = forecast.attendance_tomorrow(daily)
        lo, hi = out["interval80"]
        assert lo <= out["prediction"] <= hi

    def test_prediction_stays_within_a_plausible_rate_range(self):
        students = students_frame(10)
        daily = attendance.daily_rates(attendance_frame(students, school_days(12)), 10)
        out = forecast.attendance_tomorrow(daily)
        assert 0.0 <= out["prediction"] <= 1.0

    def test_flat_history_does_not_produce_nan(self):
        """Zero-variance history must forecast a number, not NaN."""
        students = students_frame(8)
        daily = attendance.daily_rates(attendance_frame(students, school_days(8)), 8)
        out = forecast.attendance_tomorrow(daily)
        assert not np.isnan(out["prediction"])


class TestSubstituteDemand:
    def test_no_school_days_cannot_be_forecast(self):
        assert forecast.substitute_demand(0, 0, 5)["available"] is False

    def test_zero_absences_uses_the_rule_of_three_upper_bound(self):
        out = forecast.substitute_demand(0, 20, 5)
        assert out["available"] is True
        assert out["prediction"] == 0
        assert "rule-of-three" in out["model"].lower() or "poisson" in out["model"].lower()

    def test_rate_is_absences_per_school_day(self):
        # The dashboard labels this "substitute demand ≈ N/day" — absences
        # across the whole staff per day, not per individual teacher.
        out = forecast.substitute_demand(10, 20, 5)
        assert out["prediction"] == pytest.approx(0.5, abs=0.01)

    def test_interval_brackets_the_rate(self):
        out = forecast.substitute_demand(8, 20, 4)
        lo, hi = out["interval80"]
        assert lo <= out["prediction"] <= hi


class TestFeeCollections:
    def test_no_fee_records_is_unavailable(self):
        assert forecast.fee_collections({"insufficient": True})["available"] is False

    def test_expected_recovery_is_bounded_by_the_wilson_interval(self):
        finance = {
            "insufficient": False,
            "payment_history_available": False,
            "aging_buckets": [
                {"bucket": "Not yet due", "outstanding": 1000.0},
                {"bucket": "1-30d", "outstanding": 500.0},
            ],
            "recovery_by_bucket": [
                {"bucket": "Not yet due", "collected_ratio": 0.5,
                 "fully_paid_wilson95": [0.3, 0.7]},
                {"bucket": "1-30d", "collected_ratio": 0.4,
                 "fully_paid_wilson95": [0.2, 0.6]},
            ],
        }
        out = forecast.fee_collections(finance)
        lo, hi = out["interval95"]
        assert lo <= out["prediction"] <= hi

    def test_missing_history_is_declared_as_a_caveat(self):
        finance = {
            "insufficient": False, "payment_history_available": False,
            "aging_buckets": [{"bucket": "1-30d", "outstanding": 100.0}],
            "recovery_by_bucket": [{"bucket": "1-30d", "collected_ratio": 0.5,
                                    "fully_paid_wilson95": [0.2, 0.8]}],
        }
        assert forecast.fee_collections(finance)["caveat"] is not None

    def test_bucket_without_a_ratio_is_skipped_not_guessed(self):
        finance = {
            "insufficient": False, "payment_history_available": True,
            "aging_buckets": [{"bucket": "61d+", "outstanding": 900.0}],
            "recovery_by_bucket": [{"bucket": "61d+", "collected_ratio": None,
                                    "fully_paid_wilson95": [0.0, 1.0]}],
        }
        out = forecast.fee_collections(finance)
        assert out["parts"] == []
        assert out["prediction"] == 0


class TestDocumentReviewLoad:
    def test_no_documents_is_unavailable(self):
        assert forecast.document_review_load({"insufficient": True})["available"] is False

    def test_forecast_equals_current_queue_and_says_so(self):
        out = forecast.document_review_load({"insufficient": False, "review_queue": 7})
        assert out["prediction"] == 7
        assert "queue" in out["note"].lower()


class TestClassDayAnomalies:
    def test_empty_input_yields_no_anomalies(self):
        out = isolation.class_day_anomalies(
            pd.DataFrame(columns=["studentId", "classId", "date", "status"]),
            classes_frame(["6A"]))
        assert out == []

    def test_uniform_data_reports_nothing_rather_than_noise(self):
        """The honesty guard: identical days have no outlier to find."""
        students = students_frame(20)
        rows = attendance_frame(students, school_days(10))
        out = isolation.class_day_anomalies(rows, classes_frame(["6A"]))
        assert out == []

    def test_findings_are_capped_and_carry_their_model(self):
        students = students_frame(22)
        dates = school_days(14)
        rows = []
        for i, date in enumerate(dates):
            absent = 12 if i == 5 else (i % 3)  # one dramatic outlier day
            rows.append(attendance_frame(students.head(22 - absent), [date], "PRESENT"))
            if absent:
                rows.append(attendance_frame(students.tail(absent), [date], "ABSENT"))
        out = isolation.class_day_anomalies(pd.concat(rows), classes_frame(["6A"]))
        assert len(out) <= 4
        for a in out:
            assert a["kind"] == "ATTENDANCE_CLASS_DAY"
            assert "IsolationForest" in a["model"]
            assert 0.0 <= a["anomaly_score"] <= 1.0


class TestFeeAnomalies:
    def _open_fees(self, n: int, uniform: bool) -> pd.DataFrame:
        return pd.DataFrame([
            {
                "studentId": f"s{i}",
                "amount": 1000.0 if uniform else 1000.0 + i * 137,
                "outstanding": 500.0 if uniform else 500.0 + i * 91,
                "days_past_due": 10 if uniform else i * 3,
            }
            for i in range(n)
        ])

    def test_none_input_is_handled(self):
        assert isolation.fee_anomalies(None, students_frame(3)) == []

    def test_too_few_accounts_to_judge(self):
        assert isolation.fee_anomalies(self._open_fees(4, False), students_frame(4)) == []

    def test_near_uniform_ledger_reports_nothing(self):
        """A seeded ledger where everyone owes the same is not anomalous."""
        assert isolation.fee_anomalies(self._open_fees(20, True), students_frame(20)) == []

    def test_varied_ledger_produces_scored_findings(self):
        out = isolation.fee_anomalies(self._open_fees(30, False), students_frame(30))
        for a in out:
            assert a["kind"] == "FEE_ACCOUNT"
            assert 0.0 <= a["anomaly_score"] <= 1.0
            assert "days past due" in a["description"]

    def test_days_past_due_is_never_negative_in_the_description(self):
        """Clamped upstream — a future-dated fee must not read as '-30 days'."""
        fees = self._open_fees(30, False)
        out = isolation.fee_anomalies(fees, students_frame(30))
        for a in out:
            assert a["features"]["days_past_due"] >= 0

    def test_is_deterministic_across_runs(self):
        fees = self._open_fees(30, False)
        first = isolation.fee_anomalies(fees, students_frame(30))
        second = isolation.fee_anomalies(fees, students_frame(30))
        assert [a["entity"] for a in first] == [a["entity"] for a in second]
