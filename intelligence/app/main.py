"""Meridian Intelligence Engine — FastAPI microservice.

Run:  python -m uvicorn app.main:app --port 8010 --reload   (from intelligence/)

Node's Express API is the only intended caller (React never talks to this
service directly). The engine reads the operational database read-only and
returns fully traced, reproducible intelligence.
"""
from __future__ import annotations

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from .config import DB_PATH, ENGINE_VERSION
from .inference.engine import run

app = FastAPI(title="Meridian Intelligence Engine", version=ENGINE_VERSION)


class DashboardRequest(BaseModel):
    schoolId: str
    date: str | None = None       # reserved; engine anchors on latest data day
    timeWindow: str | None = None  # reserved


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "engine": "meridian-intelligence", "version": ENGINE_VERSION, "db": str(DB_PATH), "dbExists": DB_PATH.exists()}


@app.post("/intelligence/dashboard")
def dashboard(req: DashboardRequest) -> dict:
    try:
        return run(req.schoolId)
    except FileNotFoundError as e:
        raise HTTPException(status_code=503, detail=str(e))
