"""Shared fixtures for the intelligence engine tests.

The engine's public surface is `build(frames, anchor)` per feature module, where
`frames` is exactly what `app/db.py::load_school_frames` returns — a dict of
pandas DataFrames with the same columns as the SQL SELECTs there.

These builders construct those frames in memory. Nothing is mocked: the real
pandas/scipy/sklearn code paths run. Only the database is replaced, and only
because the module contract is "a dict of frames", not "a connection".
"""
from __future__ import annotations

from datetime import datetime, timedelta

import pandas as pd
import pytest

ANCHOR = "2026-03-20"  # a Friday


def _d(offset: int, anchor: str = ANCHOR) -> str:
    """A date string `offset` days before the anchor."""
    return (datetime.fromisoformat(anchor) - timedelta(days=offset)).strftime("%Y-%m-%d")


def school_days(count: int, anchor: str = ANCHOR) -> list[str]:
    """`count` weekday date strings ending at the anchor, newest last."""
    out: list[str] = []
    cursor = datetime.fromisoformat(anchor)
    while len(out) < count:
        if cursor.weekday() < 5:
            out.append(cursor.strftime("%Y-%m-%d"))
        cursor -= timedelta(days=1)
    return list(reversed(out))


# ── frame builders ───────────────────────────────────────────────────────────

def students_frame(n: int = 10, class_id: str = "c1", active: int = 1,
                   face_enrolled: int = 0) -> pd.DataFrame:
    return pd.DataFrame([
        {"id": f"s{i}", "name": f"Student {i}", "classId": class_id,
         "active": active, "faceEnrolled": face_enrolled}
        for i in range(1, n + 1)
    ])


def classes_frame(names: list[str] | None = None) -> pd.DataFrame:
    names = names or ["6A"]
    return pd.DataFrame([
        {"id": f"c{i + 1}", "grade": 6 + i, "section": "A", "name": name,
         "classTeacherId": f"t{i + 1}"}
        for i, name in enumerate(names)
    ])


def attendance_frame(students: pd.DataFrame, dates: list[str],
                     status: str = "PRESENT", source: str = "FACE",
                     confidence: float | None = 0.97) -> pd.DataFrame:
    rows = [
        {"studentId": s.id, "classId": s.classId, "date": date,
         "status": status, "source": source, "confidence": confidence}
        for date in dates
        for s in students.itertuples()
    ]
    return pd.DataFrame(rows, columns=["studentId", "classId", "date", "status",
                                       "source", "confidence"])


def fees_frame(rows: list[dict]) -> pd.DataFrame:
    """rows: [{studentId, amount, paid, dueDate, status?, title?}]"""
    return pd.DataFrame([
        {
            "id": r.get("id", f"f{i}"),
            "studentId": r["studentId"],
            "title": r.get("title", "Term 1 Tuition"),
            "amount": r["amount"],
            "paid": r["paid"],
            "dueDate": r["dueDate"],
            "status": r.get("status", "PENDING"),
        }
        for i, r in enumerate(rows)
    ])


def teachers_frame(n: int = 3, weekly: int = 12, max_hours: int = 24) -> pd.DataFrame:
    return pd.DataFrame([
        {"id": f"t{i}", "maxHours": max_hours, "weeklyHours": weekly,
         "department": "Science", "name": f"Teacher {i}"}
        for i in range(1, n + 1)
    ])


def empty(columns: list[str]) -> pd.DataFrame:
    return pd.DataFrame(columns=columns)


EMPTY_FRAMES: dict[str, list[str]] = {
    "students": ["id", "name", "classId", "active", "faceEnrolled"],
    "classes": ["id", "grade", "section", "name", "classTeacherId"],
    "attendance": ["studentId", "classId", "date", "status", "source", "confidence"],
    "events": ["studentId", "sessionId", "source", "timestamp", "direction",
               "verificationStatus", "faceConfidence", "late", "lateMinutes"],
    "fees": ["id", "studentId", "title", "amount", "paid", "dueDate", "status"],
    "payments": ["feeId", "amount", "paidAt"],
    "teachers": ["id", "maxHours", "weeklyHours", "department", "name"],
    "absences": ["id", "teacherId", "date"],
    "substitutions": ["absenceId", "accepted"],
    "timetable": ["id", "name", "score", "healthString", "updatedAt"],
    "slots": ["day", "period", "classId", "teacherId", "roomId"],
    "documents": ["id", "status", "overallConfidence", "correctionCount",
                  "createdAt", "updatedAt"],
    "doc_fields": ["documentId", "status", "confidence", "required", "valid"],
    "students_face": ["id", "faceEnrolled", "active"],
    "sessions": ["id", "status", "date", "startTime", "expiryTime", "closedAt"],
}


def blank_frames() -> dict[str, pd.DataFrame]:
    """Every frame present but empty — the "brand new school" case."""
    return {name: empty(cols) for name, cols in EMPTY_FRAMES.items()}


@pytest.fixture
def anchor() -> str:
    return ANCHOR


@pytest.fixture
def frames() -> dict[str, pd.DataFrame]:
    """A small, healthy school: 10 students, 10 school days, all present."""
    students = students_frame(10)
    dates = school_days(10)
    f = blank_frames()
    f["students"] = students
    f["students_face"] = pd.DataFrame(
        [{"id": s.id, "faceEnrolled": 1, "active": 1} for s in students.itertuples()]
    )
    f["classes"] = classes_frame(["6A"])
    f["attendance"] = attendance_frame(students, dates)
    f["teachers"] = teachers_frame(3)
    return f
