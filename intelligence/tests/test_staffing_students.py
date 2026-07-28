"""Staffing features and the per-student at-risk index."""
from __future__ import annotations

import pandas as pd
import pytest

from app.feature_engineering import staffing, students as students_fe
from tests.conftest import (
    ANCHOR,
    _d,
    attendance_frame,
    blank_frames,
    classes_frame,
    fees_frame,
    school_days,
    students_frame,
    teachers_frame,
)

# ANCHOR (2026-03-20) is a Friday -> Kairos day index 4.
ANCHOR_DAY_INDEX = 4


class TestStaffingLoad:
    def test_no_teachers_is_insufficient(self):
        assert staffing.build(blank_frames(), ANCHOR)["insufficient"] is True

    def test_load_ratio_and_overload_threshold(self):
        f = blank_frames()
        f["teachers"] = pd.DataFrame([
            {"id": "t1", "maxHours": 20, "weeklyHours": 19, "department": "Sci", "name": "A"},
            {"id": "t2", "maxHours": 20, "weeklyHours": 10, "department": "Sci", "name": "B"},
        ])
        out = staffing.build(f, ANCHOR)
        assert out["overloaded_count"] == 1       # 19/20 = 0.95
        assert out["spare_capacity_count"] == 1   # 10/20 = 0.50

    def test_zero_max_hours_does_not_divide_by_zero(self):
        f = blank_frames()
        f["teachers"] = pd.DataFrame([
            {"id": "t1", "maxHours": 0, "weeklyHours": 5, "department": "Sci", "name": "A"},
        ])
        out = staffing.build(f, ANCHOR)
        assert out["avg_load_ratio"] == pytest.approx(5.0)  # divisor replaced by 1

    def test_absence_rate_needs_exposure(self):
        f = blank_frames()
        f["teachers"] = teachers_frame(2)
        out = staffing.build(f, ANCHOR)
        assert out["absence_rate"] is None  # no school days recorded


class TestUncoveredCover:
    def _frames_with_absence(self, accepted: bool | None):
        f = blank_frames()
        f["teachers"] = teachers_frame(2)
        f["absences"] = pd.DataFrame([{"id": "a1", "teacherId": "t1", "date": ANCHOR}])
        if accepted is not None:
            f["substitutions"] = pd.DataFrame([{"absenceId": "a1", "accepted": accepted}])
        f["students"] = students_frame(6, class_id="c1")
        f["classes"] = classes_frame(["6A"])
        f["slots"] = pd.DataFrame([
            {"day": ANCHOR_DAY_INDEX, "period": 1, "classId": "c1",
             "teacherId": "t1", "roomId": "r1"},
        ])
        return f

    def test_absence_with_no_substitution_is_uncovered(self):
        out = staffing.build(self._frames_with_absence(None), ANCHOR)
        assert out["uncovered_today"] == 1

    def test_declined_substitution_still_leaves_it_uncovered(self):
        """The insight claims "no accepted substitution" — the filter must agree."""
        out = staffing.build(self._frames_with_absence(False), ANCHOR)
        assert out["uncovered_today"] == 1

    def test_accepted_substitution_covers_it(self):
        out = staffing.build(self._frames_with_absence(True), ANCHOR)
        assert out["uncovered_today"] == 0

    def test_affected_students_come_from_the_real_roster(self):
        """Never an assumed class size — 6 enrolled means 6 affected."""
        out = staffing.build(self._frames_with_absence(None), ANCHOR)
        assert out["uncovered_classes_today"] == 1
        assert out["students_affected_today"] == 6

    def test_without_a_timetable_headcount_is_unknown_not_invented(self):
        f = self._frames_with_absence(None)
        f["slots"] = blank_frames()["slots"]
        out = staffing.build(f, ANCHOR)
        assert out["students_affected_today"] is None

    def test_absence_on_another_day_does_not_count_today(self):
        f = self._frames_with_absence(None)
        f["absences"] = pd.DataFrame([{"id": "a1", "teacherId": "t1", "date": _d(3)}])
        assert staffing.build(f, ANCHOR)["uncovered_today"] == 0


class TestAtRiskIndex:
    def _frames(self, rate_by_student: dict[str, float], fees=None, days: int = 10):
        """rate_by_student: id -> attendance rate in [0,1]."""
        dates = school_days(days)
        ids = list(rate_by_student)
        students = pd.DataFrame([
            {"id": i, "name": f"Student {i}", "classId": "c1",
             "active": 1, "faceEnrolled": 0} for i in ids
        ])
        rows = []
        for sid, rate in rate_by_student.items():
            present_days = round(rate * days)
            for d_i, date in enumerate(dates):
                rows.append({
                    "studentId": sid, "classId": "c1", "date": date,
                    "status": "PRESENT" if d_i < present_days else "ABSENT",
                    "source": "FACE", "confidence": 0.97,
                })
        f = blank_frames()
        f["students"] = students
        f["classes"] = classes_frame(["6A"])
        f["attendance"] = pd.DataFrame(rows)
        if fees:
            f["fees"] = fees_frame(fees)
        return f

    def test_no_attendance_means_no_defensible_index(self):
        f = blank_frames()
        f["students"] = students_frame(3)
        out = students_fe.build(f, ANCHOR)
        assert out["available"] is False

    def test_too_few_complete_days_refuses_to_score(self):
        out = students_fe.build(self._frames({"s1": 1.0}, days=3), ANCHOR)
        assert out["available"] is False
        assert "4" in out["reason"]

    def test_perfect_attendance_is_not_flagged(self):
        out = students_fe.build(self._frames({f"s{i}": 1.0 for i in range(1, 6)}), ANCHOR)
        assert out["available"] is True
        assert out["n_flagged"] == 0

    def test_poor_attendance_is_flagged(self):
        out = students_fe.build(
            self._frames({"s1": 0.3, "s2": 1.0, "s3": 1.0, "s4": 1.0}), ANCHOR)
        flagged = [s["studentId"] for s in out["students"]]
        assert "s1" in flagged

    def test_risk_scores_are_sorted_worst_first(self):
        out = students_fe.build(
            self._frames({"s1": 0.2, "s2": 0.5, "s3": 0.65, "s4": 1.0}), ANCHOR)
        scores = [s["riskScore"] for s in out["students"]]
        assert scores == sorted(scores, reverse=True)

    def test_risk_score_is_a_bounded_percentage(self):
        out = students_fe.build(
            self._frames({f"s{i}": i / 10 for i in range(1, 10)}), ANCHOR)
        assert all(0 <= s["riskScore"] <= 100 for s in out["students"])

    def test_declared_weights_are_published_with_the_index(self):
        out = students_fe.build(self._frames({"s1": 0.4, "s2": 1.0}), ANCHOR)
        assert set(out["weights"]) == {
            "attendance_deficit", "fee_overdue", "late_share", "attendance_trend"}
        assert sum(out["weights"].values()) == pytest.approx(1.0)
        assert "risk =" in out["formula"]

    def test_fee_reason_separates_past_due_from_not_yet_due(self):
        """Guards the wording fix: ₹X past due, with future billing called out."""
        fees = [
            {"studentId": "s1", "amount": 12500, "paid": 0, "dueDate": _d(50)},
            {"studentId": "s1", "amount": 2200, "paid": 0, "dueDate": _d(-30)},
        ]
        out = students_fe.build(self._frames({"s1": 0.5, "s2": 1.0}, fees=fees), ANCHOR)
        reasons = " ".join(out["students"][0]["reasons"])
        assert "past due" in reasons
        assert "not yet due" in reasons

    def test_factors_expose_both_fee_totals(self):
        fees = [
            {"studentId": "s1", "amount": 1000, "paid": 0, "dueDate": _d(40)},
            {"studentId": "s1", "amount": 500, "paid": 0, "dueDate": _d(-10)},
        ]
        out = students_fe.build(self._frames({"s1": 0.4, "s2": 1.0}, fees=fees), ANCHOR)
        factors = out["students"][0]["factors"]
        assert factors["feesPastDue"] == 1000
        assert factors["feesDue"] == 1500

    def test_a_fee_not_yet_due_does_not_create_overdue_days(self):
        fees = [{"studentId": "s1", "amount": 900, "paid": 0, "dueDate": _d(-15)}]
        out = students_fe.build(self._frames({"s1": 0.4, "s2": 1.0}, fees=fees), ANCHOR)
        assert out["students"][0]["factors"]["feeOverdueDays"] == 0

    def test_every_flagged_student_carries_a_reason(self):
        out = students_fe.build(
            self._frames({"s1": 0.3, "s2": 0.4, "s3": 1.0}), ANCHOR)
        assert all(s["reasons"] for s in out["students"])

    def test_confidence_is_attached_per_student(self):
        out = students_fe.build(self._frames({"s1": 0.3, "s2": 1.0}), ANCHOR)
        conf = out["students"][0]["confidence"]
        assert 0 <= conf["value"] <= 100
        assert conf["explanation"]

    def test_output_list_is_capped_for_the_payload(self):
        out = students_fe.build(
            self._frames({f"s{i}": 0.2 for i in range(1, 30)}), ANCHOR)
        assert len(out["students"]) <= 12
        assert out["n_flagged"] >= len(out["students"])
