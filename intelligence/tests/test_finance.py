"""Finance features — aging buckets, overdue accounts, recovery evidence.

These lock in the definition of "overdue" that the whole product shares:
past the due date AND not fully paid, counted as distinct students. A fee that
is merely unpaid but not yet due is NOT overdue.
"""
from __future__ import annotations

import pandas as pd
import pytest

from app.feature_engineering import finance
from tests.conftest import ANCHOR, _d, blank_frames, fees_frame


def _frames(fee_rows, payments=None):
    f = blank_frames()
    f["fees"] = fees_frame(fee_rows)
    if payments is not None:
        f["payments"] = pd.DataFrame(payments)
    return f


class TestEmptyAndDegenerate:
    def test_no_fees_reports_insufficient_rather_than_zeroes(self):
        out = finance.build(blank_frames(), ANCHOR)
        assert out["insufficient"] is True
        assert out["n_fees"] == 0

    def test_all_fees_fully_paid_leaves_no_open_accounts(self):
        out = finance.build(
            _frames([{"studentId": "s1", "amount": 1000, "paid": 1000, "dueDate": _d(60)}]),
            ANCHOR,
        )
        assert out["open_accounts"] == 0
        assert out["total_outstanding"] == 0
        assert out["overdue_accounts"] == 0

    def test_overpayment_does_not_create_negative_outstanding(self):
        out = finance.build(
            _frames([{"studentId": "s1", "amount": 1000, "paid": 1500, "dueDate": _d(60)}]),
            ANCHOR,
        )
        assert out["total_outstanding"] == 0


class TestOverdueDefinition:
    def test_future_dated_fee_is_open_but_not_overdue(self):
        """The bug this guards: a fee due next month was counted as aged."""
        out = finance.build(
            _frames([{"studentId": "s1", "amount": 1000, "paid": 0, "dueDate": _d(-30)}]),
            ANCHOR,
        )
        assert out["open_accounts"] == 1
        assert out["overdue_accounts"] == 0
        assert out["overdue_outstanding"] == 0

    def test_past_due_unpaid_fee_is_overdue(self):
        out = finance.build(
            _frames([{"studentId": "s1", "amount": 1000, "paid": 0, "dueDate": _d(10)}]),
            ANCHOR,
        )
        assert out["overdue_accounts"] == 1
        assert out["overdue_outstanding"] == 1000

    def test_past_due_but_fully_paid_is_not_overdue(self):
        out = finance.build(
            _frames([{"studentId": "s1", "amount": 1000, "paid": 1000, "dueDate": _d(90)}]),
            ANCHOR,
        )
        assert out["overdue_accounts"] == 0

    def test_partially_paid_past_due_is_overdue_for_the_remainder(self):
        out = finance.build(
            _frames([{"studentId": "s1", "amount": 1000, "paid": 400, "dueDate": _d(10)}]),
            ANCHOR,
        )
        assert out["overdue_accounts"] == 1
        assert out["overdue_outstanding"] == 600

    def test_fee_due_exactly_on_the_anchor_is_not_yet_overdue(self):
        # Boundary: due today means the day is not over.
        out = finance.build(
            _frames([{"studentId": "s1", "amount": 500, "paid": 0, "dueDate": ANCHOR}]),
            ANCHOR,
        )
        assert out["overdue_accounts"] == 0

    def test_one_day_past_due_is_overdue(self):
        out = finance.build(
            _frames([{"studentId": "s1", "amount": 500, "paid": 0, "dueDate": _d(1)}]),
            ANCHOR,
        )
        assert out["overdue_accounts"] == 1


class TestAccountsAreStudentsNotRows:
    def test_two_unpaid_fees_for_one_student_is_one_account(self):
        """A student owing three bills is one account to chase, not three."""
        out = finance.build(
            _frames([
                {"studentId": "s1", "amount": 1000, "paid": 0, "dueDate": _d(10)},
                {"studentId": "s1", "amount": 500, "paid": 0, "dueDate": _d(20)},
            ]),
            ANCHOR,
        )
        assert out["overdue_accounts"] == 1
        assert out["overdue_fee_records"] == 2
        assert out["overdue_outstanding"] == 1500

    def test_open_accounts_counts_distinct_students(self):
        out = finance.build(
            _frames([
                {"studentId": "s1", "amount": 100, "paid": 0, "dueDate": _d(-5)},
                {"studentId": "s1", "amount": 100, "paid": 0, "dueDate": _d(-6)},
                {"studentId": "s2", "amount": 100, "paid": 0, "dueDate": _d(-5)},
            ]),
            ANCHOR,
        )
        assert out["open_accounts"] == 2
        assert out["open_fee_records"] == 3


class TestAgingBuckets:
    def test_bucket_labels_and_order_are_stable(self):
        out = finance.build(
            _frames([{"studentId": "s1", "amount": 100, "paid": 0, "dueDate": _d(10)}]),
            ANCHOR,
        )
        labels = [b["bucket"] for b in out["aging_buckets"]]
        assert labels == ["Not yet due", "1-30d", "31-60d", "61d+"]

    @pytest.mark.parametrize("days,expected", [
        (-10, "Not yet due"),
        (1, "1-30d"),
        (30, "1-30d"),
        (31, "31-60d"),
        (60, "31-60d"),
        (61, "61d+"),
        (400, "61d+"),
    ])
    def test_fee_lands_in_the_right_bucket(self, days, expected):
        out = finance.build(
            _frames([{"studentId": "s1", "amount": 100, "paid": 0, "dueDate": _d(days)}]),
            ANCHOR,
        )
        holding = [b for b in out["aging_buckets"] if b["accounts"] == 1]
        assert len(holding) == 1
        assert holding[0]["bucket"] == expected

    def test_buckets_partition_the_open_money_exactly_once(self):
        rows = [
            {"studentId": f"s{i}", "amount": 100, "paid": 0, "dueDate": _d(days)}
            for i, days in enumerate([-20, 5, 40, 90])
        ]
        out = finance.build(_frames(rows), ANCHOR)
        bucketed = sum(b["outstanding"] for b in out["aging_buckets"])
        assert bucketed == pytest.approx(out["total_outstanding"])

    def test_overdue_outstanding_excludes_the_not_yet_due_bucket(self):
        rows = [
            {"studentId": "s1", "amount": 100, "paid": 0, "dueDate": _d(-20)},
            {"studentId": "s2", "amount": 250, "paid": 0, "dueDate": _d(40)},
        ]
        out = finance.build(_frames(rows), ANCHOR)
        not_due = next(b for b in out["aging_buckets"] if b["bucket"] == "Not yet due")
        assert not_due["outstanding"] == 100
        assert out["overdue_outstanding"] == 250


class TestRecoveryEvidence:
    def test_recovery_rows_align_with_bucket_rows(self):
        """forecasting zips these two lists — they must stay index-aligned."""
        rows = [
            {"studentId": f"s{i}", "amount": 100, "paid": 0, "dueDate": _d(days)}
            for i, days in enumerate([-20, 5, 40, 90])
        ]
        out = finance.build(_frames(rows), ANCHOR)
        assert len(out["aging_buckets"]) == len(out["recovery_by_bucket"])
        for bucket, recovery in zip(out["aging_buckets"], out["recovery_by_bucket"]):
            assert bucket["bucket"] == recovery["bucket"]

    def test_wilson_interval_brackets_the_point_estimate(self):
        rows = [{"studentId": f"s{i}", "amount": 100,
                 "paid": 100 if i % 2 else 0, "dueDate": _d(10)} for i in range(10)]
        out = finance.build(_frames(rows), ANCHOR)
        band = next(r for r in out["recovery_by_bucket"] if r["bucket"] == "1-30d")
        low, high = band["fully_paid_wilson95"]
        assert 0.0 <= low <= band["fully_paid_rate"] <= high <= 1.0

    def test_empty_bucket_reports_none_not_a_fabricated_ratio(self):
        out = finance.build(
            _frames([{"studentId": "s1", "amount": 100, "paid": 0, "dueDate": _d(5)}]),
            ANCHOR,
        )
        empty_band = next(r for r in out["recovery_by_bucket"] if r["n"] == 0)
        assert empty_band["collected_ratio"] is None
        assert empty_band["fully_paid_rate"] is None


class TestWilsonInterval:
    def test_no_observations_gives_the_widest_possible_interval(self):
        assert finance.wilson_interval(0, 0) == (0.0, 1.0)

    def test_interval_is_bounded_to_probability_range(self):
        for successes, n in [(0, 10), (10, 10), (3, 7), (1, 100)]:
            low, high = finance.wilson_interval(successes, n)
            assert 0.0 <= low <= high <= 1.0

    def test_interval_narrows_as_evidence_grows(self):
        narrow = finance.wilson_interval(500, 1000)
        wide = finance.wilson_interval(5, 10)
        assert (narrow[1] - narrow[0]) < (wide[1] - wide[0])


class TestPaymentHistory:
    def test_absent_history_is_declared_not_assumed(self):
        out = finance.build(
            _frames([{"studentId": "s1", "amount": 100, "paid": 0, "dueDate": _d(5)}]),
            ANCHOR,
        )
        assert out["payment_history_available"] is False
        assert out["payment_history"] is None

    def test_present_history_is_summarised(self):
        fees = [{"id": "f0", "studentId": "s1", "amount": 100, "paid": 100,
                 "dueDate": _d(10)}]
        payments = [{"feeId": "f0", "amount": 100,
                     "paidAt": f"{_d(5)}T10:00:00.000Z"}]
        out = finance.build(_frames(fees, payments), ANCHOR)
        assert out["payment_history_available"] is True
        assert out["payment_history"]["students_with_history"] == 1


class TestTopOpenAccounts:
    def test_ordered_by_largest_outstanding_first(self):
        rows = [
            {"studentId": "s1", "amount": 100, "paid": 0, "dueDate": _d(5)},
            {"studentId": "s2", "amount": 900, "paid": 0, "dueDate": _d(5)},
            {"studentId": "s3", "amount": 500, "paid": 0, "dueDate": _d(5)},
        ]
        out = finance.build(_frames(rows), ANCHOR)
        amounts = [a["outstanding"] for a in out["top_open_accounts"]]
        assert amounts == sorted(amounts, reverse=True)

    def test_capped_at_five_entries(self):
        rows = [{"studentId": f"s{i}", "amount": 100 * i, "paid": 0,
                 "dueDate": _d(5)} for i in range(1, 12)]
        out = finance.build(_frames(rows), ANCHOR)
        assert len(out["top_open_accounts"]) <= 5


class TestOutstandingRatio:
    def test_ratio_is_outstanding_over_billed(self):
        rows = [
            {"studentId": "s1", "amount": 1000, "paid": 750, "dueDate": _d(5)},
        ]
        out = finance.build(_frames(rows), ANCHOR)
        assert out["outstanding_ratio"] == pytest.approx(0.25)

    def test_zero_billed_does_not_divide_by_zero(self):
        out = finance.build(
            _frames([{"studentId": "s1", "amount": 0, "paid": 0, "dueDate": _d(5)}]),
            ANCHOR,
        )
        assert out["outstanding_ratio"] is None
