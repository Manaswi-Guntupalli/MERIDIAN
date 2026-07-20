"""Optional LLM polish — rewrites explanation PROSE only.

The numbers, confidences, rankings and recommendations are computed before
this module ever runs, and it can only replace the `reason` text of an
insight with a nicer sentence built from the SAME structured evidence. If
OPENAI_API_KEY is unset or the call fails, the deterministic text stands.
Uses stdlib urllib so the engine has no hard dependency on an SDK.
"""
from __future__ import annotations

import json
import os
import urllib.request


def polish_reasons(insights: list[dict]) -> bool:
    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        return False
    try:
        payload = {
            "model": os.environ.get("OPENAI_MODEL", "gpt-4o-mini"),
            "messages": [
                {
                    "role": "system",
                    "content": "Rewrite each 'reason' as one clear sentence for a school principal. "
                    "Use ONLY the numbers in the evidence — never add causes, numbers or claims. "
                    "Return JSON: {\"reasons\": [\"...\"]} in the same order.",
                },
                {"role": "user", "content": json.dumps([
                    {"reason": i["reason"], "evidence": i["evidence"]} for i in insights
                ])},
            ],
            "response_format": {"type": "json_object"},
        }
        req = urllib.request.Request(
            "https://api.openai.com/v1/chat/completions",
            data=json.dumps(payload).encode(),
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
        reasons = json.loads(data["choices"][0]["message"]["content"]).get("reasons", [])
        if len(reasons) == len(insights):
            for insight, text in zip(insights, reasons):
                insight["reason"] = str(text)
                insight["trace"]["llmPolished"] = True
            return True
    except Exception:
        pass  # deterministic text remains — the dashboard never depends on the LLM
    return False
