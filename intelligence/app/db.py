"""Read-only access to the Meridian SQLite database.

The engine NEVER writes. Connections open with mode=ro so a bug here cannot
corrupt operational data. Every loader filters by schoolId — the engine is
tenant-scoped like the rest of the platform.
"""
from __future__ import annotations

import sqlite3
from contextlib import contextmanager

import pandas as pd

from .config import DB_PATH


@contextmanager
def connect():
    if not DB_PATH.exists():
        raise FileNotFoundError(f"Database not found at {DB_PATH} — set MERIDIAN_DB")
    uri = f"file:{DB_PATH.as_posix()}?mode=ro"
    conn = sqlite3.connect(uri, uri=True)
    try:
        yield conn
    finally:
        conn.close()


def frame(conn: sqlite3.Connection, sql: str, params: tuple = ()) -> pd.DataFrame:
    return pd.read_sql_query(sql, conn, params=params)


def load_school_frames(school_id: str) -> dict[str, pd.DataFrame]:
    """One round trip for everything the modules need."""
    with connect() as conn:
        p = (school_id,)
        return {
            "students": frame(conn, "SELECT id, name, classId, active, faceEnrolled FROM Student WHERE schoolId=?", p),
            "classes": frame(conn, "SELECT id, grade, section, name, classTeacherId FROM Class WHERE schoolId=?", p),
            "attendance": frame(
                conn,
                "SELECT studentId, classId, date, status, source, confidence FROM Attendance WHERE schoolId=?",
                p,
            ),
            "events": frame(
                conn,
                "SELECT studentId, sessionId, source, timestamp, direction, verificationStatus, faceConfidence, late, lateMinutes "
                "FROM AttendanceEvent WHERE schoolId=?",
                p,
            ),
            "fees": frame(conn, "SELECT id, studentId, title, amount, paid, dueDate, status FROM Fee WHERE schoolId=?", p),
            "payments": frame(
                conn,
                "SELECT Payment.feeId, Payment.amount, Payment.paidAt FROM Payment "
                "JOIN Fee ON Fee.id = Payment.feeId WHERE Fee.schoolId=?",
                p,
            ),
            "teachers": frame(
                conn,
                "SELECT Teacher.id, Teacher.maxHours, Teacher.weeklyHours, Teacher.department, User.name "
                "FROM Teacher JOIN User ON User.id = Teacher.userId WHERE Teacher.schoolId=?",
                p,
            ),
            "absences": frame(
                conn,
                "SELECT StaffAbsence.id, StaffAbsence.teacherId, StaffAbsence.date "
                "FROM StaffAbsence JOIN Teacher ON Teacher.id = StaffAbsence.teacherId WHERE Teacher.schoolId=?",
                p,
            ),
            "substitutions": frame(
                conn,
                "SELECT Substitution.absenceId, Substitution.accepted FROM Substitution "
                "JOIN StaffAbsence ON StaffAbsence.id = Substitution.absenceId "
                "JOIN Teacher ON Teacher.id = StaffAbsence.teacherId WHERE Teacher.schoolId=?",
                p,
            ),
            "timetable": frame(
                conn,
                "SELECT id, name, score, healthString, updatedAt FROM Timetable WHERE schoolId=? AND active=1",
                p,
            ),
            "slots": frame(
                conn,
                "SELECT TimetableSlot.day, TimetableSlot.period, TimetableSlot.classId, TimetableSlot.teacherId, "
                "TimetableSlot.roomId FROM TimetableSlot "
                "JOIN Timetable ON Timetable.id = TimetableSlot.timetableId "
                "WHERE Timetable.schoolId=? AND Timetable.active=1",
                p,
            ),
            "documents": frame(
                conn,
                "SELECT id, status, overallConfidence, correctionCount, createdAt, updatedAt FROM Document WHERE schoolId=?",
                p,
            ),
            "doc_fields": frame(
                conn,
                "SELECT ExtractedField.documentId, ExtractedField.status, ExtractedField.confidence, "
                "ExtractedField.required, ExtractedField.valid FROM ExtractedField "
                "JOIN Document ON Document.id = ExtractedField.documentId WHERE Document.schoolId=?",
                p,
            ),
            "students_face": frame(conn, "SELECT id, faceEnrolled, active FROM Student WHERE schoolId=?", p),
            "sessions": frame(conn, "SELECT id, status, date, startTime, expiryTime, closedAt FROM AttendanceSession WHERE schoolId=?", p),
        }
