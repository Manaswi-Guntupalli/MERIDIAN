"""Operations feature engineering — Presence infrastructure reliability."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pandas as pd


def build(frames: dict, anchor_date: str) -> dict:
    readers: pd.DataFrame = frames["readers"]
    beats: pd.DataFrame = frames["heartbeats"]
    events: pd.DataFrame = frames["events"]

    online = int((readers["online"] == 1).sum()) if not readers.empty else 0
    total = int(len(readers))

    beats_24h = 0
    mean_signal = None
    if not beats.empty:
        ts = pd.to_datetime(beats["timestamp"], utc=True, errors="coerce")
        recent = beats[ts >= datetime.now(timezone.utc) - timedelta(hours=24)]
        beats_24h = int(len(recent))
        sig = recent["signal"].dropna()
        mean_signal = round(float(sig.mean()), 3) if len(sig) else None

    ev = {}
    if not events.empty:
        counts = events["verificationStatus"].value_counts()
        total_ev = int(len(events))
        ev = {
            "events_total": total_ev,
            "verified": int(counts.get("VERIFIED", 0) + counts.get("LATE", 0)),
            "duplicates": int(counts.get("DUPLICATE", 0)),
            "unknown_cards": int(counts.get("UNKNOWN", 0)),
            "rejected": int(counts.get("REJECTED", 0)),
            "rejection_rate": round(float(counts.get("REJECTED", 0)) / total_ev, 4),
            "rfid_share": round(float((events["source"] == "RFID").mean()), 4),
        }

    return {
        "readers_total": total,
        "readers_online": online,
        "reader_uptime_now": round(online / total, 4) if total else None,
        "heartbeats_24h": beats_24h,
        "mean_signal_24h": mean_signal,
        **ev,
    }
