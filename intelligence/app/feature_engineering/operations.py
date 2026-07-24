"""Operations feature engineering — attendance CAPTURE INTEGRITY.

Replaces the old RFID-reader-uptime signal. With face + QR attendance, the
operational health question is: is attendance being captured cleanly? We
measure it from real events — the share of clean marks vs proxy attempts and
QR-only-never-verified — plus face-enrollment coverage, which caps how much of
the school the primary (face) method can even reach.
"""
from __future__ import annotations

import pandas as pd


def build(frames: dict, anchor_date: str) -> dict:
    events: pd.DataFrame = frames["events"]
    students: pd.DataFrame = frames.get("students_face", pd.DataFrame())
    sessions: pd.DataFrame = frames.get("sessions", pd.DataFrame())

    # Face-enrollment coverage — the ceiling on the primary method's reach.
    enrolled = total_students = 0
    if not students.empty:
        active = students[students["active"] == 1]
        total_students = int(len(active))
        enrolled = int((active["faceEnrolled"] == 1).sum())
    coverage = round(enrolled / total_students, 4) if total_students else None

    ev: dict = {}
    capture_integrity = None
    if not events.empty:
        counts = events["verificationStatus"].value_counts()
        verified = int(counts.get("VERIFIED", 0) + counts.get("LATE", 0))
        proxy = int(counts.get("PROXY", 0))
        unverified_qr = int(counts.get("UNVERIFIED_QR", 0))
        total_ev = int(len(events))
        # Clean captures / (clean + the two failure modes). A run with no
        # proxy attempts and no stranded QR-only marks scores 1.0.
        denom = verified + proxy + unverified_qr
        capture_integrity = round(verified / denom, 4) if denom else None
        src = events["source"]
        ev = {
            "events_total": total_ev,
            "verified": verified,
            "proxy_attempts": proxy,
            "unverified_qr": unverified_qr,
            "face_share": round(float((src == "FACE").mean()), 4),
            "qr_share": round(float((src == "QR").mean()), 4),
            "manual_share": round(float((src == "MANUAL").mean()), 4),
        }

    sessions_total = int(len(sessions)) if not sessions.empty else 0

    return {
        "enrollment_coverage": coverage,
        "enrolled_students": enrolled,
        "total_students": total_students,
        "capture_integrity": capture_integrity,
        "sessions_total": sessions_total,
        **ev,
    }
