import * as faceapi from '@vladmandic/face-api';

// On-device face pipeline (TensorFlow.js). Detector + 68-pt landmarks +
// 128-D recognition embeddings, all in the browser. No image ever leaves
// the device — only the vector does. Models are served from /public/models.

let loadPromise: Promise<void> | null = null;

export function loadFaceModels(): Promise<void> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const tf = faceapi.tf as any;
      await tf.setBackend('webgl');
      await tf.ready();
    } catch {
      /* fall back to default backend */
    }
    const url = '/models';
    await faceapi.nets.tinyFaceDetector.loadFromUri(url);
    await faceapi.nets.faceLandmark68Net.loadFromUri(url);
    await faceapi.nets.faceRecognitionNet.loadFromUri(url);
  })();
  return loadPromise;
}

const detectorOptions = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.45 });

// Capture the current video frame as a base64 JPEG to send to the server for
// embedding. Face MATCHING and embedding both live server-side now (InsightFace)
// — the browser only ever ships pixels over TLS, never a forgeable descriptor,
// and the server discards the image after embedding.
const captureCanvas = document.createElement('canvas');
export function captureFrameBase64(video: HTMLVideoElement, maxWidth = 640): string {
  const w = video.videoWidth || 640;
  const h = video.videoHeight || 480;
  const scale = Math.min(1, maxWidth / w);
  captureCanvas.width = Math.round(w * scale);
  captureCanvas.height = Math.round(h * scale);
  const ctx = captureCanvas.getContext('2d');
  if (!ctx) return '';
  ctx.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height);
  return captureCanvas.toDataURL('image/jpeg', 0.85).split(',', 2)[1];
}

export type FaceInput = HTMLVideoElement | HTMLCanvasElement | HTMLImageElement;

export interface DetectedFace {
  descriptor: number[];
  box: { x: number; y: number; width: number; height: number };
  score: number;
  landmarks: faceapi.FaceLandmarks68;
}

// Single best face (for enrollment / single-subject recognition).
export async function detectSingle(input: FaceInput): Promise<DetectedFace | null> {
  const res = await faceapi
    .detectSingleFace(input, detectorOptions)
    .withFaceLandmarks()
    .withFaceDescriptor();
  if (!res) return null;
  const b = res.detection.box;
  return {
    descriptor: Array.from(res.descriptor),
    box: { x: b.x, y: b.y, width: b.width, height: b.height },
    score: res.detection.score,
    landmarks: res.landmarks,
  };
}

// Fast landmark-only detection (no descriptor) — cheap enough to run every
// frame for blink/liveness without stalling the recognition loop.
export async function detectLandmarksOnly(input: FaceInput): Promise<faceapi.FaceLandmarks68 | null> {
  const res = await faceapi.detectSingleFace(input, detectorOptions).withFaceLandmarks();
  return res?.landmarks ?? null;
}

// A self-calibrating blink detector. Tracks the person's open-eye EAR and
// fires when the eyes dip well below it (relative), then recover — robust
// across faces, glasses and lighting where a fixed threshold fails.
export class BlinkDetector {
  private earOpen = 0.3;
  private closed = false;
  armedUntil = 0;

  update(ear: number): boolean {
    if (ear > this.earOpen) this.earOpen = ear;
    else this.earOpen = this.earOpen * 0.96 + ear * 0.04; // slow decay toward current
    const closedThresh = Math.max(0.15, this.earOpen * 0.72);
    if (ear < closedThresh) {
      this.closed = true;
    } else if (this.closed && ear > this.earOpen * 0.9) {
      this.closed = false;
      this.armedUntil = Date.now() + 3200; // liveness window after a blink
      return true; // blink completed this frame
    }
    return false;
  }

  get armed(): boolean {
    return Date.now() < this.armedUntil;
  }
}

// All faces (for the classroom kiosk — multi-face recognition).
export async function detectAll(input: FaceInput): Promise<DetectedFace[]> {
  const res = await faceapi
    .detectAllFaces(input, detectorOptions)
    .withFaceLandmarks()
    .withFaceDescriptors();
  return res.map((r) => {
    const b = r.detection.box;
    return {
      descriptor: Array.from(r.descriptor),
      box: { x: b.x, y: b.y, width: b.width, height: b.height },
      score: r.detection.score,
      landmarks: r.landmarks,
    };
  });
}

// ── Head-pose estimate → guides the enrollment ("look left", etc.) ──
export type Pose = 'front' | 'left' | 'right' | 'up' | 'down';

/**
 * Returns two pose-invariant-scaled signals:
 *  - yaw:   (nose − eye-centre).x / interocular   → sign = left/right turn
 *  - pitch: (eyes→nose) / (nose→chin)  vertical ratio → MONOTONIC for tilt:
 *           looking DOWN foreshortens the lower face → ratio ↑
 *           looking UP  elongates  the lower face → ratio ↓
 * Absolute pitch varies per face, so callers compare it to a per-person
 * neutral baseline captured during the "look straight" step.
 */
export function estimatePose(landmarks: faceapi.FaceLandmarks68): { yaw: number; pitch: number } {
  const p = landmarks.positions;
  const noseTip = p[30];
  const chin = p[8];
  const leftEye = center(landmarks.getLeftEye());
  const rightEye = center(landmarks.getRightEye());
  const eyeCenter = { x: (leftEye.x + rightEye.x) / 2, y: (leftEye.y + rightEye.y) / 2 };
  const interocular = Math.hypot(rightEye.x - leftEye.x, rightEye.y - leftEye.y) || 1;

  const yaw = (noseTip.x - eyeCenter.x) / interocular;
  const upper = noseTip.y - eyeCenter.y;
  const lower = Math.max(1, chin.y - noseTip.y);
  const pitch = upper / lower;
  return { yaw, pitch };
}

// Classify a pose given the person's calibrated neutral pitch baseline.
export function classifyPose(yaw: number, pitch: number, baseline: number | null): Pose {
  if (yaw > 0.18) return 'left';
  if (yaw < -0.18) return 'right';
  if (baseline != null) {
    if (pitch < baseline * 0.82) return 'up';
    if (pitch > baseline * 1.18) return 'down';
  }
  return 'front';
}

// ── Eye-aspect-ratio → blink detection for liveness ──
export function eyeAspectRatio(landmarks: faceapi.FaceLandmarks68): number {
  const ear = (eye: faceapi.Point[]) => {
    const a = dist(eye[1], eye[5]);
    const b = dist(eye[2], eye[4]);
    const c = dist(eye[0], eye[3]);
    return (a + b) / (2 * c || 1);
  };
  return (ear(landmarks.getLeftEye()) + ear(landmarks.getRightEye())) / 2;
}

export const BLINK_EAR = 0.22; // below → eyes closed (legacy fixed threshold)

// NOTE: face MATCHING intentionally lives on the server. Enrolled biometric
// templates are never shipped to the browser — the kiosk sends the descriptor
// it computed from its own frame to /face/recognize-batch and gets back only
// a name + confidence. See server/src/services/face.ts.

// ── Capture quality: size, sharpness proxy (detector score) & brightness ──
export interface Quality {
  ok: boolean;
  score: number; // 0..1
  brightness: number; // 0..255
  reason?: string;
}

export function assessQuality(input: FaceInput, face: DetectedFace): Quality {
  const w = (input as HTMLVideoElement).videoWidth || (input as HTMLCanvasElement).width || 640;
  const faceRatio = face.box.width / w;
  const brightness = sampleBrightness(input, face.box);

  if (face.score < 0.55) return { ok: false, score: face.score, brightness, reason: 'Hold still — low confidence' };
  if (faceRatio < 0.16) return { ok: false, score: face.score, brightness, reason: 'Move closer' };
  if (faceRatio > 0.72) return { ok: false, score: face.score, brightness, reason: 'Move back a little' };
  if (brightness < 55) return { ok: false, score: face.score, brightness, reason: 'Too dark — find more light' };
  if (brightness > 235) return { ok: false, score: face.score, brightness, reason: 'Too bright — reduce glare' };
  return { ok: true, score: face.score, brightness };
}

// ── helpers ──
function center(pts: faceapi.Point[]) {
  const x = pts.reduce((a, p) => a + p.x, 0) / pts.length;
  const y = pts.reduce((a, p) => a + p.y, 0) / pts.length;
  return { x, y };
}
function dist(a: faceapi.Point, b: faceapi.Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

const sampleCanvas = document.createElement('canvas');
function sampleBrightness(input: FaceInput, box: { x: number; y: number; width: number; height: number }): number {
  try {
    const sw = 32;
    const sh = 32;
    sampleCanvas.width = sw;
    sampleCanvas.height = sh;
    const ctx = sampleCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return 128;
    ctx.drawImage(input as CanvasImageSource, box.x, box.y, box.width, box.height, 0, 0, sw, sh);
    const data = ctx.getImageData(0, 0, sw, sh).data;
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    return sum / (data.length / 4);
  } catch {
    return 128;
  }
}
