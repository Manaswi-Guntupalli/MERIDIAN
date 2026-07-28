"""Whole-engine integration: the payload the dashboard actually consumes.

These are the tests that matter for a live demo — the engine must return a
JSON-serialisable payload for every shape of school, including the degenerate
ones, rather than throwing and showing "engine offline".
"""
from __future__ import annotations

import json

import pandas as pd
import pytest

from app.inference import engine
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


def run_with(frames: dict, monkeypatch) -> dict:
    """Run the engine against in-memory frames instead of the database."""
    monkeypatch.setattr(engine, "load_school_frames", lambda school_id: frames)
    return engine.run("test-school")


def healthy_frames(days: int = 10, students: int = 12) -> dict:
    s = students_frame(students)
    f = blank_frames()
    f["students"] = s
    f["students_face"] = pd.DataFrame(
        [{"id": r.id, "faceEnrolled": 1, "active": 1} for r in s.itertuples()])
    f["classes"] = classes_frame(["6A"])
    f["attendance"] = attendance_frame(s, school_days(days))
    f["teachers"] = teachers_frame(3)
    return f


class TestPayloadContract:
    def test_top_level_keys_the_clients_depend_on(self, monkeypatch):
        out = run_with(healthy_frames(), monkeypatch)
        for key in ["meta", "healthScore", "insights", "recommendations",
                    "anomalies", "forecasts", "atRisk", "featureSummaries"]:
            assert key in out, f"missing {key} — a client reads this"

    def test_payload_is_strict_json_serialisable(self, monkeypatch):
        """NaN/Infinity are not valid JSON; Dart's jsonDecode rejects them."""
        out = run_with(healthy_frames(), monkeypatch)
        text = json.dumps(out)

        def reject(constant):
            raise AssertionError(f"non-JSON constant in payload: {constant}")

        json.loads(text, parse_constant=reject)

    def test_every_insight_carries_its_evidence_and_trace(self, monkeypatch):
        out = run_with(healthy_frames(), monkeypatch)
        for insight in out["insights"]:
            assert insight["evidence"], f"{insight['id']} has no evidence"
            assert insight["reason"], f"{insight['id']} has no reason"
            assert insight["trace"]["model"], f"{insight['id']} names no model"
            assert 0 <= insight["confidence"]["value"] <= 100

    def test_insights_are_ordered_by_severity(self, monkeypatch):
        out = run_with(healthy_frames(), monkeypatch)
        rank = {"CRITICAL": 0, "WARNING": 1, "INFO": 2, "SUCCESS": 3}
        order = [rank.get(i["severity"], 2) for i in out["insights"]]
        assert order == sorted(order)

    def test_meta_states_the_anchor_and_engine_version(self, monkeypatch):
        out = run_with(healthy_frames(), monkeypatch)
        assert out["meta"]["anchorDate"]
        assert out["meta"]["engineVersion"]

    def test_recommendations_reference_real_insights(self, monkeypatch):
        out = run_with(healthy_frames(), monkeypatch)
        ids = {i["id"] for i in out["insights"]}
        for rec in out["recommendations"]:
            if rec.get("insightId"):
                assert rec["insightId"] in ids


class TestDegenerateSchools:
    def test_completely_empty_school_does_not_crash(self, monkeypatch):
        out = run_with(blank_frames(), monkeypatch)
        json.dumps(out)
        assert out["insights"]

    def test_perfect_attendance_does_not_crash(self, monkeypatch):
        """Zero-variance regression returns NaN; it must not reach the payload."""
        out = run_with(healthy_frames(days=10), monkeypatch)
        trend = next(i for i in out["insights"] if i["id"] == "attendance-trend")
        assert trend["trace"]["features"]["p_value"] == 1.0
        assert trend["confidence"]["value"] == 0

    def test_single_student_single_day(self, monkeypatch):
        out = run_with(healthy_frames(days=1, students=1), monkeypatch)
        json.dumps(out)

    def test_students_but_no_attendance_yet(self, monkeypatch):
        f = blank_frames()
        f["students"] = students_frame(20)
        f["classes"] = classes_frame(["6A"])
        out = run_with(f, monkeypatch)
        trend = next(i for i in out["insights"] if i["id"] == "attendance-trend")
        assert "insufficient" in trend["title"].lower() or trend["severity"] == "INFO"

    def test_all_students_inactive(self, monkeypatch):
        f = healthy_frames()
        f["students"]["active"] = 0
        out = run_with(f, monkeypatch)
        json.dumps(out)

    def test_school_with_no_teachers(self, monkeypatch):
        f = healthy_frames()
        f["teachers"] = blank_frames()["teachers"]
        out = run_with(f, monkeypatch)
        json.dumps(out)


class TestFinanceIntegration:
    def _with_fees(self, rows):
        f = healthy_frames()
        f["fees"] = fees_frame(rows)
        return f

    def test_overdue_action_counts_students_past_due_only(self, monkeypatch):
        rows = [
            {"studentId": "s1", "amount": 1000, "paid": 0, "dueDate": _d(40)},
            {"studentId": "s2", "amount": 1000, "paid": 0, "dueDate": _d(10)},
            {"studentId": "s3", "amount": 1000, "paid": 0, "dueDate": _d(-30)},
        ]
        out = run_with(self._with_fees(rows), monkeypatch)
        action = next(r for r in out["recommendations"] if r["id"] == "act-fees")
        assert "2 overdue fee account(s)" in action["title"]
        assert action["affectedCount"] == 2

    def test_no_overdue_means_no_followup_action(self, monkeypatch):
        rows = [{"studentId": "s1", "amount": 1000, "paid": 0, "dueDate": _d(-30)}]
        out = run_with(self._with_fees(rows), monkeypatch)
        assert not [r for r in out["recommendations"] if r["id"] == "act-fees"]

    def test_fee_insight_separates_due_from_not_yet_due(self, monkeypatch):
        rows = [
            {"studentId": "s1", "amount": 1000, "paid": 0, "dueDate": _d(10)},
            {"studentId": "s2", "amount": 500, "paid": 0, "dueDate": _d(-30)},
        ]
        out = run_with(self._with_fees(rows), monkeypatch)
        insight = next(i for i in out["insights"] if i["id"] == "fee-aging")
        labels = [e["label"] for e in insight["evidence"]]
        assert "Past due" in labels
        assert "Not yet due" in labels


class TestStaffingIntegration:
    def test_uncovered_action_uses_real_roster_not_an_assumed_class_size(self, monkeypatch):
        f = healthy_frames()
        f["absences"] = pd.DataFrame([{"id": "a1", "teacherId": "t1", "date": ANCHOR}])
        f["slots"] = pd.DataFrame([
            {"day": 4, "period": 1, "classId": "c1", "teacherId": "t1", "roomId": "r1"},
        ])
        out = run_with(f, monkeypatch)
        action = next((r for r in out["recommendations"] if r["id"] == "act-cover"), None)
        assert action is not None
        # 12 students are enrolled in c1 — not a hardcoded 30.
        assert action["affectedCount"] == 12


class TestDeterminism:
    def test_two_runs_produce_identical_analysis(self, monkeypatch):
        frames = healthy_frames()
        first = run_with(frames, monkeypatch)
        second = run_with(frames, monkeypatch)
        assert first["healthScore"] == second["healthScore"]
        assert ([r["priorityScore"] for r in first["recommendations"]]
                == [r["priorityScore"] for r in second["recommendations"]])
        assert [i["id"] for i in first["insights"]] == [i["id"] for i in second["insights"]]

    def test_engine_does_not_mutate_the_caller_frames(self, monkeypatch):
        frames = healthy_frames()
        before = {k: len(v) for k, v in frames.items()}
        run_with(frames, monkeypatch)
        after = {k: len(v) for k, v in frames.items()}
        assert before == after
