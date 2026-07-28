"""Attendance analytics — daily rates, OLS trend, deviations, coverage."""
from __future__ import annotations

import pandas as pd
import pytest

from app.feature_engineering import attendance
from tests.conftest import (
    ANCHOR,
    attendance_frame,
    blank_frames,
    classes_frame,
    school_days,
    students_frame,
)


def _frames(students, dates, status="PRESENT", classes=None):
    f = blank_frames()
    f["students"] = students
    f["classes"] = classes if classes is not None else classes_frame(["6A"])
    f["attendance"] = attendance_frame(students, dates, status=status)
    return f


class TestDailyRates:
    def test_all_present_is_a_full_rate(self):
        students = students_frame(10)
        daily = attendance.daily_rates(attendance_frame(students, school_days(3)), 10)
        assert list(daily["rate"]) == [1.0, 1.0, 1.0]

    def test_late_counts_as_attended(self):
        """A late child is in the building — the rate must reflect that."""
        students = students_frame(4)
        daily = attendance.daily_rates(
            attendance_frame(students, school_days(1), status="LATE"), 4)
        assert daily["rate"].iloc[0] == 1.0
        assert daily["late"].iloc[0] == 4

    def test_absent_lowers_the_rate(self):
        students = students_frame(4)
        rows = pd.concat([
            attendance_frame(students.head(3), school_days(1), status="PRESENT"),
            attendance_frame(students.tail(1), school_days(1), status="ABSENT"),
        ])
        daily = attendance.daily_rates(rows, 4)
        assert daily["rate"].iloc[0] == pytest.approx(0.75)

    def test_empty_attendance_returns_an_empty_frame_with_the_schema(self):
        daily = attendance.daily_rates(
            pd.DataFrame(columns=["studentId", "classId", "date", "status",
                                  "source", "confidence"]), 10)
        assert daily.empty
        for col in ["date", "marks", "attended", "rate", "coverage", "partial"]:
            assert col in daily.columns

    def test_day_below_half_coverage_is_flagged_partial(self):
        """A morning with 2/10 marked must not enter the window as a 100% day."""
        students = students_frame(10)
        daily = attendance.daily_rates(
            attendance_frame(students.head(2), school_days(1)), active_students=10)
        assert bool(daily["partial"].iloc[0]) is True

    def test_day_at_exactly_half_coverage_is_representative(self):
        students = students_frame(10)
        daily = attendance.daily_rates(
            attendance_frame(students.head(5), school_days(1)), active_students=10)
        assert bool(daily["partial"].iloc[0]) is False

    def test_zero_active_students_does_not_divide_by_zero(self):
        students = students_frame(2)
        daily = attendance.daily_rates(attendance_frame(students, school_days(1)), 0)
        assert daily["coverage"].iloc[0] == 0.0

    def test_rows_are_sorted_by_date(self):
        students = students_frame(3)
        daily = attendance.daily_rates(attendance_frame(students, school_days(5)), 3)
        assert list(daily["date"]) == sorted(daily["date"])


class TestTrend:
    def test_fewer_than_four_days_is_insufficient(self):
        students = students_frame(5)
        daily = attendance.daily_rates(attendance_frame(students, school_days(3)), 5)
        assert attendance.trend(daily)["insufficient"] is True

    def test_four_days_is_enough_to_measure(self):
        students = students_frame(5)
        daily = attendance.daily_rates(attendance_frame(students, school_days(4)), 5)
        assert attendance.trend(daily)["insufficient"] is False

    def test_flat_attendance_has_no_slope(self):
        students = students_frame(10)
        daily = attendance.daily_rates(attendance_frame(students, school_days(8)), 10)
        assert attendance.trend(daily)["slope"] == pytest.approx(0.0, abs=1e-9)

    def test_declining_attendance_gives_a_negative_slope(self):
        dates = school_days(6)
        students = students_frame(10)
        rows = []
        for i, date in enumerate(dates):
            present = 10 - i  # 10, 9, 8 ... a clean decline
            rows.append(attendance_frame(students.head(present), [date], "PRESENT"))
            if present < 10:
                rows.append(attendance_frame(students.tail(10 - present), [date], "ABSENT"))
        daily = attendance.daily_rates(pd.concat(rows), 10)
        t = attendance.trend(daily)
        assert t["slope"] < 0
        assert t["change_pct_points"] < 0

    def test_improving_attendance_gives_a_positive_slope(self):
        dates = school_days(6)
        students = students_frame(10)
        rows = []
        for i, date in enumerate(dates):
            present = 5 + i
            rows.append(attendance_frame(students.head(present), [date], "PRESENT"))
            rows.append(attendance_frame(students.tail(10 - present), [date], "ABSENT"))
        daily = attendance.daily_rates(pd.concat(rows), 10)
        assert attendance.trend(daily)["slope"] > 0

    def test_reports_the_window_it_measured(self):
        students = students_frame(5)
        daily = attendance.daily_rates(attendance_frame(students, school_days(6)), 5)
        t = attendance.trend(daily)
        assert t["window"][0] < t["window"][1]
        assert t["n"] == 6

    def test_p_value_and_r2_are_within_valid_ranges(self):
        students = students_frame(8)
        daily = attendance.daily_rates(attendance_frame(students, school_days(7)), 8)
        t = attendance.trend(daily)
        assert 0.0 <= t["p_value"] <= 1.0
        assert 0.0 <= t["r2"] <= 1.0


class TestGroupDeviations:
    def test_empty_attendance_returns_nulls_not_zeros(self):
        out = attendance.group_deviations(
            pd.DataFrame(columns=["studentId", "classId", "date", "status"]),
            classes_frame(["6A"]))
        assert out["school_rate"] is None
        assert out["classes"] == []

    def test_single_class_deviates_zero_from_the_school_mean(self):
        students = students_frame(6, class_id="c1")
        out = attendance.group_deviations(
            attendance_frame(students, school_days(3)), classes_frame(["6A"]))
        assert out["classes"][0]["deviation_pct_points"] == pytest.approx(0.0)

    def test_worse_class_sorts_first(self):
        classes = classes_frame(["6A", "7A"])
        good = students_frame(5, class_id="c1")
        bad = students_frame(5, class_id="c2")
        bad["id"] = [f"b{i}" for i in range(1, 6)]
        rows = pd.concat([
            attendance_frame(good, school_days(2), "PRESENT"),
            attendance_frame(bad, school_days(2), "ABSENT"),
        ])
        out = attendance.group_deviations(rows, classes)
        assert out["classes"][0]["deviation_pct_points"] < 0

    def test_weekday_breakdown_is_produced(self):
        students = students_frame(4)
        out = attendance.group_deviations(
            attendance_frame(students, school_days(5)), classes_frame(["6A"]))
        assert len(out["weekdays"]) >= 1
        assert all("key" in w and "rate" in w for w in out["weekdays"])


class TestCoverageAndSources:
    def test_source_mix_sums_to_one(self):
        students = students_frame(6)
        rows = pd.concat([
            attendance_frame(students.head(3), school_days(1), source="FACE"),
            attendance_frame(students.tail(3), school_days(1), source="QR"),
        ])
        f = blank_frames()
        out = attendance.coverage_and_sources(rows, f["events"], students, ANCHOR)
        assert sum(out["source_mix"].values()) == pytest.approx(1.0)

    def test_missing_ratio_reflects_unmarked_students(self):
        students = students_frame(10)
        rows = attendance_frame(students.head(4), [ANCHOR])
        f = blank_frames()
        out = attendance.coverage_and_sources(rows, f["events"], students, ANCHOR)
        assert out["missing_ratio"] == pytest.approx(0.6)

    def test_no_active_students_yields_null_missing_ratio(self):
        students = students_frame(2, active=0)
        f = blank_frames()
        out = attendance.coverage_and_sources(f["attendance"], f["events"], students, ANCHOR)
        assert out["missing_ratio"] is None

    def test_late_events_key_is_named_for_what_it_counts(self):
        """Renamed from late_events_window: it spans the whole event log."""
        students = students_frame(3)
        f = blank_frames()
        out = attendance.coverage_and_sources(
            attendance_frame(students, [ANCHOR]), f["events"], students, ANCHOR)
        assert "late_events_total" in out


class TestBuild:
    def test_partial_days_are_excluded_from_the_trend(self):
        students = students_frame(10)
        dates = school_days(6)
        full = attendance_frame(students, dates[:-1])
        partial = attendance_frame(students.head(1), [dates[-1]])  # 1/10 marked
        f = blank_frames()
        f["students"] = students
        f["classes"] = classes_frame(["6A"])
        f["attendance"] = pd.concat([full, partial])
        out = attendance.build(f, dates[-1])
        assert out["complete_days"] == 5
        assert out["in_progress_day"]["date"] == dates[-1]

    def test_healthy_school_reports_a_measurable_trend(self, frames, anchor):
        out = attendance.build(frames, anchor)
        assert out["trend"]["insufficient"] is False
        assert out["deviations"]["school_rate"] == pytest.approx(1.0)

    def test_no_attendance_at_all_is_handled(self):
        f = blank_frames()
        f["students"] = students_frame(5)
        f["classes"] = classes_frame(["6A"])
        out = attendance.build(f, ANCHOR)
        assert out["trend"]["insufficient"] is True
        assert out["complete_days"] == 0
