"""Meridian Face Service — the ONLY component that turns pixels into a face
embedding. It exists so no raw image ever has to be trusted from, or stored by,
the browser: a client-supplied descriptor is trivially forgeable, which would
defeat the whole anti-proxy design. Here the server sees the pixels, embeds
them in memory, and discards them — only the 512-D vector ever leaves.

Contract (called ONLY by the Node server, never the browser):
  POST /embed  { "image": "<base64 jpeg/png>" }
    → { "ok": true, "found": true, "embedding": [512 floats, L2-normalised],
        "detScore": 0.87, "bbox": [x1,y1,x2,y2], "model": "insightface-buffalo_l" }
    → { "ok": true, "found": false }                 (no face in the frame)

The embedding is L2-normalised, so cosine similarity == dot product on the
Node side. Nothing is written to disk; there is no database access here.
"""
from __future__ import annotations

import base64
import binascii
import os
from contextlib import asynccontextmanager

import numpy as np
from fastapi import FastAPI
from pydantic import BaseModel

MODEL_NAME = "buffalo_l"
MODEL_ID = "insightface-buffalo_l"   # the string persisted with every embedding
EMBED_DIM = 512
DET_SIZE = int(os.environ.get("FACE_DET_SIZE", "640"))

_app_model = None  # lazily initialised InsightFace FaceAnalysis


def _load_model():
    global _app_model
    if _app_model is None:
        from insightface.app import FaceAnalysis  # heavy import, deferred
        m = FaceAnalysis(name=MODEL_NAME, providers=["CPUExecutionProvider"])
        m.prepare(ctx_id=-1, det_size=(DET_SIZE, DET_SIZE))
        _app_model = m
    return _app_model


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Warm the model at boot so the first real request isn't a 30s cold start.
    _load_model()
    yield


api = FastAPI(title="Meridian Face Service", version="1.0.0", lifespan=lifespan)


class EmbedRequest(BaseModel):
    image: str  # base64-encoded JPEG/PNG bytes (optionally a data: URL)


@api.get("/health")
def health():
    return {"status": "ok", "service": "meridian-face", "model": MODEL_ID, "dim": EMBED_DIM, "loaded": _app_model is not None}


@api.post("/embed")
def embed(req: EmbedRequest):
    raw = req.image.split(",", 1)[1] if req.image.startswith("data:") else req.image
    try:
        img_bytes = base64.b64decode(raw, validate=True)
    except (binascii.Error, ValueError):
        return {"ok": False, "error": "image is not valid base64"}

    import cv2  # deferred so /health stays cheap
    arr = np.frombuffer(img_bytes, np.uint8)
    frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if frame is None:
        return {"ok": False, "error": "could not decode image"}

    faces = _load_model().get(frame)
    if not faces:
        # In-memory frame is dropped here regardless — never persisted.
        return {"ok": True, "found": False, "model": MODEL_ID}

    # Largest detected face wins (the person actually presenting at the camera).
    face = max(faces, key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1]))
    vec = np.asarray(face.normed_embedding, dtype=np.float32)  # already L2-normalised
    return {
        "ok": True,
        "found": True,
        "embedding": [round(float(x), 6) for x in vec.tolist()],
        "detScore": round(float(face.det_score), 4),
        "bbox": [round(float(v), 1) for v in face.bbox.tolist()],
        "model": MODEL_ID,
        "dim": EMBED_DIM,
    }
