"""Inference orchestrator — raw DB ➜ features ➜ models ➜ insights.

Every insight leaving this module carries: evidence rows (real numbers),
a computed confidence with its arithmetic, affected entities, a reason
composed ONLY from computed values, and a trace block answering
"why am I seeing this?" down to the query window and model used.
"""
from __future__ import annotations

from datetime import datetime, timezone

from ..anomaly_detection import isolation
from ..confidence import build as conf_build, observed_fact
from ..db import load_school_frames
from ..feature_engineering import attendance, documents, finance, operations, staffing, students as students_fe, timetable
from ..forecasting import forecast
from ..llm import polish_reasons
from ..recommendation_engine import recommend
from ..scoring import health
from ..config import ENGINE_VERSION


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _insight(id_: str, module: str, severity: str, title: str, evidence: list, conf, affected: dict,
             reason: str, expected_impact: str, trace: dict) -> dict:
    return {
        "id": id_, "module": module, "severity": severity, "title": title,
        "evidence": evidence, "confidence": conf.as_dict(), "affected": affected,
        "reason": reason, "expectedImpact": expected_impact,
        "timestamp": _now(), "trace": {"engineVersion": ENGINE_VERSION, **trace},
    }


def run(school_id: str) -> dict:
    frames = load_school_frames(school_id)

    # Anchor on the latest day that actually has attendance data — stated in
    # the trace instead of silently pretending "today" always has marks.
    att_dates = frames["attendance"]["date"]
    anchor = str(att_dates.max()) if not att_dates.empty else datetime.now().strftime("%Y-%m-%d")

    att = attendance.build(frames, anchor)
    fin = finance.build(frames, anchor)
    staff = staffing.build(frames, anchor)
    tt = timetable.build(frames, anchor)
    docs = documents.build(frames, anchor)
    ops = operations.build(frames, anchor)

    daily_frame = att.pop("_daily_frame")
    attendance_complete_frame = att.pop("_attendance_complete")
    open_fees_frame = fin.pop("_open_fees_frame", None)

    insights: list[dict] = []
    candidates: list[dict] = []
    population = att["coverage"]["active_students"] or 1

    # ── Attendance trend ────────────────────────────────────────────────
    tr = att["trend"]
    if tr.get("insufficient"):
        insights.append(_insight(
            "attendance-trend", "attendance", "INFO", "Attendance trend not yet measurable",
            [{"label": "School days observed", "value": tr["n"]}],
            conf_build(0, 1, tr["n"], "Trend requires at least 4 school days"),
            {"count": 0, "entities": []},
            f"Only {tr['n']} school day(s) recorded — insufficient evidence to estimate a trend.",
            "None — informational.",
            {"model": "OLS linear regression (not run)", "window": None, "features": {"n_days": tr["n"]}},
        ))
    else:
        change = tr["change_pct_points"]
        dev = att["deviations"]
        worst_class = dev["classes"][0] if dev["classes"] else None
        worst_grade = dev["grades"][0] if dev["grades"] else None
        worst_day = dev["weekdays"][0] if dev["weekdays"] else None
        late_n = att["coverage"]["late_events_total"]
        declining = change < -1 and tr["p_value"] < 0.4
        severity = "WARNING" if declining else "SUCCESS"
        title = (
            f"Attendance {'declined' if change < 0 else 'improved'} {abs(change):.1f} pts over the window"
            if abs(change) >= 1 else f"Attendance steady at {dev['school_rate']*100:.1f}%"
        )
        evidence = [
            {"label": "Window", "value": f"{tr['window'][0]} → {tr['window'][1]}", "detail": f"{tr['n']} school days"},
            {"label": "First-half vs second-half avg", "value": f"{tr['first_half_avg']*100:.1f}% → {tr['last_half_avg']*100:.1f}%"},
            {"label": "OLS slope", "value": f"{tr['slope']*100:+.2f} pts/day", "detail": f"p={tr['p_value']:.2f}, R²={tr['r2']:.2f}"},
        ]
        drivers = []
        if worst_class:
            evidence.append({"label": f"Largest class deviation — {worst_class['key']}", "value": f"{worst_class['deviation_pct_points']:+.1f} pts", "detail": f"{worst_class['marks']} marks"})
            drivers.append(f"{worst_class['key']} {worst_class['deviation_pct_points']:+.1f} pts")
        if worst_grade:
            drivers.append(f"grade {worst_grade['key']} {worst_grade['deviation_pct_points']:+.1f} pts")
        if worst_day:
            evidence.append({"label": f"Weakest weekday — {worst_day['key']}", "value": f"{worst_day['deviation_pct_points']:+.1f} pts"})
            drivers.append(f"{worst_day['key']}s {worst_day['deviation_pct_points']:+.1f} pts")
        evidence.append({"label": "Late arrivals", "value": late_n, "detail": "all recorded events, not limited to the trend window"})
        # Every source (RFID / CV / manual) writes the same Attendance
        # table — show the mix so it's visible they all feed one number.
        mix = att["coverage"].get("source_mix") or {}
        if mix:
            evidence.append({
                "label": "Sources feeding attendance",
                "value": ", ".join(f"{k} {v*100:.0f}%" for k, v in sorted(mix.items(), key=lambda x: -x[1])),
            })
        ip = att.get("in_progress_day")
        if ip:
            evidence.append({
                "label": f"Roll-call in progress — {ip['date']}",
                "value": f"{ip['marks']}/{population} marked",
                "detail": "excluded from trend & health until ≥50% of students are marked",
            })
        # Completeness over the COMPLETE days only (marks recorded vs expected)
        # — partial days are excluded from the trend, not averaged into it.
        window_marks = sum(d["marks"] for d in att["daily"] if not d["partial"])
        completeness = min(window_marks / (population * tr["n"]), 1.0) if population and tr["n"] else 0.0
        conf = conf_build(1 - tr["p_value"], completeness, tr["n"],
                          "Trend signal = 1 - OLS p-value; completeness = marks recorded / (students x fully-marked school days)")
        reason = (
            f"5-day rolling average moved {tr['rolling5_start']*100:.1f}% → {tr['rolling5_end']*100:.1f}%. "
            f"Top deviations: {', '.join(drivers) if drivers else 'none'}. "
            "No external cause data (e.g. weather) is connected — drivers above are the observable evidence."
        )
        insights.append(_insight(
            "attendance-trend", "attendance", severity, title, evidence, conf,
            {"count": population, "entities": [worst_class["key"]] if worst_class else []},
            reason,
            f"Each 1 pt of attendance ≈ {round(population/100)} students present per day.",
            {"model": "OLS linear regression on daily attendance rate", "window": tr["window"],
             "features": {k: v for k, v in tr.items() if k != "insufficient"},
             "dataSources": ["Attendance", "AttendanceEvent", "Class"]},
        ))
        if declining:
            candidates.append({
                "id": "act-attendance", "title": f"Investigate the {abs(change):.1f}-pt attendance decline",
                "detail": f"Start with {worst_class['key']} ({worst_class['deviation_pct_points']:+.1f} pts vs school mean)" if worst_class else "Review class-level deviations",
                "severity": "WARNING", "confidence": conf.value, "impact": min(abs(change) / 10, 1.0),
                "affected": population, "risk": 0.7, "effort_key": "investigate_attendance",
                "action_to": "/presence/analytics", "action_label": "Open attendance analytics", "evidence_ref": "attendance-trend",
            })

    # ── Finance ─────────────────────────────────────────────────────────
    if not fin.get("insufficient") and fin["open_accounts"] > 0:
        # "Overdue" means past the due date and not fully paid — the same rule
        # the fees API and dashboard use. The 31+ day slice is reported inside
        # it as the oldest money, not as the headline count.
        overdue_accounts = fin["overdue_accounts"]
        overdue_amount = fin["overdue_outstanding"]
        aged31 = [b for b in fin["aging_buckets"] if b["bucket"] in ("31-60d", "61d+")]
        aged31_accounts = sum(b["accounts"] for b in aged31)
        aged31_amount = sum(b["outstanding"] for b in aged31)
        conf = observed_fact(fin["n_fees"], "fee ledger aging")
        evidence = [
            {"label": "Outstanding", "value": f"₹{fin['total_outstanding']:,.0f}", "detail": f"{fin['outstanding_ratio']*100:.1f}% of billed"},
            {"label": "Past due", "value": f"{overdue_accounts} account(s)",
             "detail": f"₹{overdue_amount:,.0f} — past the due date and not fully paid"},
            *[{"label": b["bucket"] if b["bucket"] == "Not yet due" else f"Aging {b['bucket']}",
               "value": f"{b['accounts']} account(s)",
               "detail": f"₹{b['outstanding']:,.0f} across {b['fee_records']} fee record(s)"} for b in fin["aging_buckets"]],
        ]
        insights.append(_insight(
            "fee-aging", "finance", "WARNING" if overdue_accounts else "INFO",
            f"{fin['open_accounts']} open fee account(s), ₹{fin['total_outstanding']:,.0f} outstanding",
            evidence, conf,
            {"count": fin["open_accounts"], "entities": [str(a["studentId"]) for a in fin["top_open_accounts"]]},
            f"{overdue_accounts} account(s) are past due (₹{overdue_amount:,.0f}), of which "
            f"{aged31_accounts} are 31+ days past due (₹{aged31_amount:,.0f}). The remaining "
            f"₹{fin['total_outstanding'] - overdue_amount:,.0f} is billed but not yet due. "
            + ("Recovery ratios are cross-sectional observations from this ledger — no longitudinal payment history exists yet."
               if not fin["payment_history_available"] else "Recovery estimates use recorded payment history."),
            f"Collecting everything past due would reduce outstanding by ₹{overdue_amount:,.0f}.",
            {"model": "Aging-bucket statistics with Wilson 95% intervals", "window": f"as of {anchor}",
             "features": {"buckets": fin["aging_buckets"], "recovery": fin["recovery_by_bucket"]},
             "dataSources": ["Fee", "Payment"]},
        ))
        # Only chase what is actually past due — if nothing is, there is no
        # follow-up to recommend and we say nothing rather than pad the list.
        if overdue_accounts:
            candidates.append({
                "id": "act-fees", "title": f"Follow up {overdue_accounts} overdue fee account(s)",
                "detail": f"₹{overdue_amount:,.0f} past due; oldest bucket first"
                          + (f" ({aged31_accounts} account(s) 31+ days)" if aged31_accounts else ""),
                "severity": "WARNING", "confidence": conf.value,
                # Impact is the past-due share of billing, not total outstanding —
                # money that is not due yet is not what this action recovers.
                "impact": min((overdue_amount / fin["total_billed"]) * 2, 1.0) if fin["total_billed"] else 0.0,
                "affected": overdue_accounts,
                "risk": 0.6, "effort_key": "followup_fees", "action_to": "/fees", "action_label": "Open fees", "evidence_ref": "fee-aging",
            })

    # ── Documents ───────────────────────────────────────────────────────
    if not docs.get("insufficient") and docs["review_queue"] > 0:
        conf = observed_fact(docs["n_documents"], "document pipeline states")
        insights.append(_insight(
            "docs-review", "documents", "INFO",
            f"{docs['review_queue']} document(s) awaiting human review",
            [
                {"label": "Queue", "value": docs["review_queue"], "detail": f"of {docs['n_documents']} total"},
                {"label": "Mean extraction confidence (queue)", "value": f"{(docs['review_mean_confidence'] or 0)*100:.0f}%"},
                {"label": "Fields flagged for review", "value": docs["fields_awaiting_review"]},
                {"label": "Oldest item in queue", "value": f"{docs['queue_age_hours_max']:.0f}h" if docs["queue_age_hours_max"] else "—"},
            ],
            conf, {"count": docs["review_queue"], "entities": []},
            f"{docs['fields_awaiting_review']} extracted field(s) fell below Lumen's auto-accept threshold and require confirmation.",
            "Clearing the queue unblocks admissions records.",
            {"model": "Direct pipeline-state counts", "window": f"as of {anchor}",
             "features": {"review_queue": docs["review_queue"], "missing_required_fields": docs["missing_required_fields"]},
             "dataSources": ["Document", "ExtractedField"]},
        ))
        candidates.append({
            "id": "act-docs", "title": f"Clear {docs['review_queue']} document(s) in review",
            "detail": f"{docs['fields_awaiting_review']} low-confidence field(s) to confirm",
            "severity": "INFO", "confidence": conf.value, "impact": 0.3,
            "affected": docs["review_queue"], "risk": 0.4, "effort_key": "review_docs",
            "action_to": "/lumen", "action_label": "Open review queue", "evidence_ref": "docs-review",
        })

    # ── Timetable ───────────────────────────────────────────────────────
    if not tt.get("insufficient") and tt["score"] < 80:
        conf = observed_fact(tt.get("slots_total", 0), "published timetable slots")
        solver = tt.get("solver_health") or {}
        warnings = solver.get("warnings", [])
        evidence = [
            {"label": "Solver score", "value": f"{tt['score']:.0f} / 100", "detail": tt["name"]},
            {"label": "Teacher idle gaps / week", "value": tt.get("teacher_idle_gaps_per_week", "—")},
            {"label": "Utilization of rooms in use", "value": f"{tt['room_utilization']*100:.0f}%" if tt.get("room_utilization") else "—",
             "detail": "share of slots filled across the rooms this timetable uses — rooms it never books are not in the denominator"},
        ]
        if warnings:
            evidence.append({"label": "Solver warnings", "value": len(warnings), "detail": str(warnings[0])[:80]})
        insights.append(_insight(
            "timetable-score", "timetable", "INFO",
            f"Active timetable scores {tt['score']:.0f}/100",
            evidence, conf, {"count": tt.get("slots_total", 0), "entities": [tt["name"]]},
            "Score and warnings come directly from the Kairos solver's published health report — soft constraints are leaving measurable room.",
            "Re-solving with relaxations typically lifts soft-constraint scores.",
            {"model": "Kairos solver output (score + healthString) + slot-grid analysis", "window": f"published {tt['updated_at'][:10]}",
             "features": {"score": tt["score"], "idle_gaps": tt.get("teacher_idle_gaps_per_week")},
             "dataSources": ["Timetable", "TimetableSlot"]},
        ))
        candidates.append({
            "id": "act-timetable", "title": f"Lift timetable score from {tt['score']:.0f}",
            "detail": f"{tt.get('teacher_idle_gaps_per_week', 0)} idle gaps/week across teachers",
            "severity": "INFO", "confidence": conf.value, "impact": (80 - tt["score"]) / 80,
            "affected": staff.get("n_teachers", 0), "risk": 0.5, "effort_key": "improve_timetable",
            "action_to": "/kairos", "action_label": "Open Kairos", "evidence_ref": "timetable-score",
        })

    # ── Staffing ────────────────────────────────────────────────────────
    if not staff.get("insufficient"):
        if staff["uncovered_today"] > 0:
            conf = observed_fact(staff["n_teachers"], "absence and substitution records")
            classes_out = staff.get("uncovered_classes_today") or 0
            # Real roster headcount for the affected classes. When there is no
            # timetable to derive it from, fall back to the absence count —
            # understating beats multiplying by an assumed class size.
            pupils = staff.get("students_affected_today")
            evidence = [
                {"label": "Uncovered absences", "value": staff["uncovered_today"],
                 "detail": "no accepted substitution recorded"},
                {"label": "Teachers with spare capacity", "value": staff["spare_capacity_count"]},
            ]
            if classes_out:
                row = {"label": "Classes left unstaffed", "value": classes_out}
                if pupils is not None:
                    row["detail"] = f"{pupils} student(s) enrolled"
                evidence.insert(1, row)
            insights.append(_insight(
                "staff-cover", "staffing", "CRITICAL",
                f"{classes_out} class(es) uncovered today" if classes_out
                else f"{staff['uncovered_today']} absence(s) uncovered today",
                evidence,
                conf, {"count": classes_out or staff["uncovered_today"], "entities": []},
                f"Absences recorded for {anchor} have no accepted substitution."
                + (f" Their timetabled slots that day cover {classes_out} class(es), {pupils} student(s)."
                   if classes_out and pupils is not None else ""),
                "Unassigned cover means unsupervised periods.",
                {"model": "Absence/substitution join (accepted only) x timetable slots for the weekday",
                 "window": anchor, "features": staff, "dataSources": ["StaffAbsence", "Substitution", "TimetableSlot", "Student"]},
            ))
            candidates.append({
                "id": "act-cover",
                "title": f"Assign cover for {classes_out} class(es)" if classes_out
                else f"Assign cover for {staff['uncovered_today']} absence(s)",
                "detail": f"{staff['spare_capacity_count']} teacher(s) under 70% load available",
                "severity": "CRITICAL", "confidence": conf.value, "impact": 0.9,
                "affected": pupils if pupils is not None else staff["uncovered_today"],
                "risk": 0.9, "effort_key": "cover_classes",
                "action_to": "/foresight", "action_label": "Suggest substitutes", "evidence_ref": "staff-cover",
            })
        if staff["overloaded_count"] > 0:
            names = ", ".join(t["name"] for t in staff["overloaded"][:3])
            conf = observed_fact(staff["n_teachers"], "teacher load records")
            insights.append(_insight(
                "staff-load", "staffing", "WARNING",
                f"{staff['overloaded_count']} teacher(s) at ≥95% of weekly cap",
                [{"label": "At/near cap", "value": names},
                 {"label": "Average load", "value": f"{staff['avg_load_ratio']*100:.0f}% of cap"}],
                conf, {"count": staff["overloaded_count"], "entities": [t["name"] for t in staff["overloaded"]]},
                "weeklyHours ÷ maxHours ≥ 0.95 from current assignments — a burnout and single-point-of-failure indicator, not a prediction.",
                "Redistributing 1-2 periods reduces replacement risk if these teachers are absent.",
                {"model": "Load-ratio threshold on current assignments", "window": "current week",
                 "features": {"overloaded": staff["overloaded"]}, "dataSources": ["Teacher"]},
            ))

    # ── Operations: attendance capture integrity ────────────────────────
    if ops.get("events_total", 0) > 0:
        proxy = ops.get("proxy_attempts", 0)
        if proxy > 0:
            conf = observed_fact(ops["events_total"], "attendance event log")
            insights.append(_insight(
                "ops-proxy", "operations", "WARNING",
                f"{proxy} proxy attendance attempt(s) blocked",
                [{"label": "Blocked", "value": proxy},
                 {"label": "Capture integrity", "value": f"{(ops.get('capture_integrity') or 0)*100:.0f}%"},
                 {"label": "Face share", "value": f"{(ops.get('face_share') or 0)*100:.0f}%"}],
                conf, {"count": proxy, "entities": []},
                "A QR identity claim did not match the live face — the mark was withheld and admins alerted.",
                "None to attendance data — the proxy was blocked before it was recorded.",
                {"model": "1:1 face verification vs the QR-claimed student", "window": "full event log",
                 "features": ops, "dataSources": ["AttendanceEvent", "FaceEmbedding"]},
            ))
        else:
            conf = observed_fact(ops.get("events_total", 0), "attendance event log")
            insights.append(_insight(
                "ops-healthy", "operations", "SUCCESS",
                f"Attendance capture clean — {(ops.get('capture_integrity') or 0)*100:.0f}% integrity",
                [{"label": "Marks logged", "value": ops.get("events_total", 0)},
                 {"label": "Face / QR / manual", "value": f"{(ops.get('face_share') or 0)*100:.0f}/{(ops.get('qr_share') or 0)*100:.0f}/{(ops.get('manual_share') or 0)*100:.0f}%"},
                 {"label": "Enrollment coverage", "value": f"{(ops.get('enrollment_coverage') or 0)*100:.0f}%"}],
                conf, {"count": ops.get("events_total", 0), "entities": []},
                "No proxy attempts and no stranded QR-only marks in the window.",
                "None — operating normally.",
                {"model": "Direct attendance-event statistics", "window": "full event log",
                 "features": ops, "dataSources": ["AttendanceEvent"]},
            ))

    # ── Early warning: at-risk students ─────────────────────────────────
    at_risk = students_fe.build(frames, anchor)
    if at_risk.get("available") and at_risk["n_flagged"] > 0:
        top = at_risk["students"][:3]
        mean_risk = sum(r["riskScore"] for r in at_risk["students"]) / len(at_risk["students"]) / 100
        mean_completeness = sum(r["confidence"]["components"].get("dataCompleteness", 0) for r in at_risk["students"]) / len(at_risk["students"])
        conf = conf_build(
            mean_risk, mean_completeness, at_risk["window"]["days"],
            "Signal = mean index of flagged students; completeness = their attendance coverage of fully-marked days",
        )
        insights.append(_insight(
            "students-at-risk", "students",
            "WARNING" if at_risk["n_high"] else "INFO",
            f"{at_risk['n_flagged']} student(s) show early-warning signals ({at_risk['n_high']} high)",
            [
                {"label": r["name"], "value": f"risk {r['riskScore']}", "detail": "; ".join(r["reasons"])[:110]}
                for r in top
            ] + [{"label": "Index window", "value": f"{at_risk['window']['from']} → {at_risk['window']['to']}", "detail": f"{at_risk['window']['days']} fully-marked days"}],
            conf,
            {"count": at_risk["n_flagged"], "entities": [r["name"] for r in at_risk["students"][:6]]},
            "Transparent weighted index over attendance rate/trend, lateness and fee aging — weights declared in the trace, factors are record observations. No grade data exists in the schema, so it is not a factor.",
            "Early outreach to the flagged families is the standard intervention before the pattern hardens.",
            {"model": "Declared-weight risk index (not a trained model — no labelled outcomes to train on)",
             "window": at_risk["window"], "features": {"formula": at_risk["formula"], "weights": at_risk["weights"], "bands": at_risk["bands"]},
             "dataSources": ["Attendance", "Fee", "Student"]},
        ))
        candidates.append({
            "id": "act-at-risk", "title": f"Reach out to {at_risk['n_flagged']} at-risk student(s)",
            "detail": ("Highest: " + ", ".join(f"{r['name']} ({r['riskScore']})" for r in top)),
            "severity": "WARNING" if at_risk["n_high"] else "INFO",
            "confidence": conf.value, "impact": min(mean_risk * 1.4, 1.0),
            "affected": at_risk["n_flagged"], "risk": 0.8, "effort_key": "contact_families",
            "action_to": "/foresight", "action_label": "Review at-risk list", "evidence_ref": "students-at-risk",
        })

    # ── Anomalies / forecasts / health / recommendations ────────────────
    # Teacher-workload anomalies are deliberately not surfaced — the staffing
    # insight already reports at-cap teachers; an anomaly row adds no signal.
    anomalies = (
        isolation.class_day_anomalies(attendance_complete_frame, frames["classes"])
        + isolation.fee_anomalies(open_fees_frame, frames["students"])
    )
    forecasts = {
        "attendanceTomorrow": forecast.attendance_tomorrow(daily_frame),
        "substituteDemand": forecast.substitute_demand(
            staff.get("absence_days_window", 0), staff.get("school_days_window", 0), staff.get("n_teachers", 0)),
        "feeCollections": forecast.fee_collections(fin),
        "documentReviewLoad": forecast.document_review_load(docs),
    }
    health_score = health.compute(att, fin, tt, docs, ops)
    recommendations = recommend.build(candidates, population)
    llm_polished = polish_reasons(insights)

    severity_rank = {"CRITICAL": 0, "WARNING": 1, "INFO": 2, "SUCCESS": 3}
    insights.sort(key=lambda i: severity_rank.get(i["severity"], 2))

    return {
        "meta": {
            "engine": "meridian-intelligence", "engineVersion": ENGINE_VERSION,
            "computedAt": _now(), "anchorDate": anchor, "schoolId": school_id,
            "llmPolished": llm_polished,
            "note": "All values computed from database records; traces on every insight.",
        },
        "healthScore": health_score,
        "insights": insights,
        "recommendations": recommendations,
        "anomalies": anomalies,
        "forecasts": forecasts,
        "atRisk": at_risk,
        "featureSummaries": {
            "attendance": {k: v for k, v in att.items() if k != "daily"},
            "finance": {k: v for k, v in fin.items() if not k.startswith("_")},
            "staffing": staff, "timetable": tt, "documents": docs, "operations": ops,
        },
    }
