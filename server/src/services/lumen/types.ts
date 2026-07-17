// Lumen — shared vocabulary for the document intelligence pipeline.
//
// The whole engine speaks in `Word`s: a token plus where it physically sits on
// the page. Everything downstream (classification, field extraction, proof
// crops) is derived from that one primitive, which is why a value can always be
// traced back to the pixels it came from.

/** A single recognised token, positioned in page pixel space. */
export interface Word {
  text: string;
  /** 0..1 — engine-reported confidence for this token. */
  conf: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Words clustered into a visual line (by vertical overlap, not by newline). */
export interface Line {
  text: string;
  words: Word[];
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  conf: number;
}

/** How legible the page actually is — drives confidence and user warnings. */
export interface QualityMetrics {
  /** Variance-of-Laplacian, normalised 0..1. Low = blurry. */
  sharpness: number;
  /** Std-dev of luminance, normalised 0..1. Low = washed out. */
  contrast: number;
  /** Effective DPI estimate against the page's physical size. */
  dpi: number;
  /** Fraction of pixels that are near-black or near-white. */
  inkCoverage: number;
  /** Human-readable verdict. */
  verdict: 'GOOD' | 'FAIR' | 'POOR';
  notes: string[];
}

export type PageSource = 'TEXT_LAYER' | 'OCR';

export interface PageResult {
  index: number;
  width: number;
  height: number;
  source: PageSource;
  /** Coarse orientation correction applied before reading (0/90/180/270). */
  rotation: number;
  /** Fine deskew angle applied, in degrees. */
  skewDeg: number;
  /** Mean word confidence, 0..1. */
  ocrConfidence: number;
  words: Word[];
  lines: Line[];
  text: string;
  quality: QualityMetrics;
  /** Rendered preview written to disk for the side-by-side reviewer. */
  previewPath?: string;
}

export type FieldType =
  | 'text'
  | 'name'
  | 'date'
  | 'email'
  | 'phone'
  | 'integer'
  | 'decimal'
  | 'percentage'
  | 'money'
  | 'pincode'
  | 'bloodGroup'
  | 'gender'
  | 'address'
  | 'id'
  | 'checkbox'
  | 'signature';

export interface FieldSpec {
  key: string;
  label: string;
  type: FieldType;
  /** Label variants as printed on real forms. Matched fuzzily, OCR-aware. */
  anchors: string[];
  required?: boolean;
  /** Constrain to a set of allowed values (gender, blood group, …). */
  options?: string[];
  /** Numeric bounds for integer/decimal/percentage/money. */
  min?: number;
  max?: number;
  /** Value may legitimately wrap onto the following line (addresses). */
  multiline?: boolean;
}

export interface DocTemplate {
  type: string;
  label: string;
  /** Which ERP entity this document ultimately becomes. */
  commits?: 'STUDENT' | 'TEACHER';
  /** Weighted phrases that identify this document type. */
  signals: { phrase: string; weight: number }[];
  fields: FieldSpec[];
}

export type FieldSource = 'TEXT_LAYER' | 'OCR' | 'REGEX' | 'AI' | 'DERIVED';
export type FieldStatus = 'AUTO' | 'REVIEW' | 'CONFIRMED' | 'MISSING';

export interface ExtractedValue {
  key: string;
  label: string;
  value: string;
  rawValue: string;
  /** Composite score — see confidence.ts for the exact formula. */
  confidence: number;
  ocrConfidence: number;
  page: number;
  crop: { x: number; y: number; w: number; h: number };
  status: FieldStatus;
  source: FieldSource;
  valid: boolean;
  validationMessage?: string;
  corrected: boolean;
  required: boolean;
}

export interface Insight {
  kind: 'DUPLICATE' | 'INCONSISTENCY' | 'MISSING' | 'CORRECTION' | 'QUALITY';
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  message: string;
  detail?: unknown;
}

export interface StageTiming {
  stage: string;
  ms: number;
  note?: string;
}

export interface ProcessResult {
  type: string;
  typeConfidence: number;
  pages: PageResult[];
  fields: ExtractedValue[];
  insights: Insight[];
  overallConfidence: number;
  rawText: string;
  timings: StageTiming[];
  processingMs: number;
}
