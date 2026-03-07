// ─── Entity Types ───────────────────────────────────────────────────────────

export type EntityType =
  | "EMAIL"
  | "PHONE"
  | "AADHAAR"
  | "PAN"
  | "NAME"
  | "ADDRESS"
  | "CARD_NUMBER"
  | "UPI"
  | "CVV"
  | "PASSPORT"
  | "IP_ADDRESS"
  | "DOB";

export type DetectionLayer = "regex" | "spacy" | "bert";

export type FileType =
  | "csv"
  | "txt"
  | "sql"
  | "json"
  | "pdf"
  | "docx"
  | "png"
  | "jpg";

export type ViewMode = "split" | "unified" | "focus";

export type DiffSide = "original" | "sanitized";

// ─── PII Entity ──────────────────────────────────────────────────────────────

export interface PiiEntity {
  id: string;
  entityType: EntityType;
  originalValue: string;
  maskedValue: string;
  startIndex: number;
  endIndex: number;
  confidence: number;
  layer: DetectionLayer;
}

// ─── Stats ───────────────────────────────────────────────────────────────────

export interface DiffStats {
  totalPiiFound: number;
  byType: Record<string, number>;
  detectionLayers: Record<string, number>;
  processingTime: number;
}

// ─── Text Segments ───────────────────────────────────────────────────────────

export interface Segment {
  text: string;
  isPii: boolean;
  entityType?: EntityType;
  entityId?: string;
  isMasked?: boolean;
}

// ─── Diff Lines ──────────────────────────────────────────────────────────────

export interface DiffLineData {
  lineNumber: number;
  originalSegments: Segment[];
  sanitizedSegments: Segment[];
  hasChanges: boolean;
}

// ─── Collapsed section (virtual row kind) ────────────────────────────────────

export interface CollapsedSectionRow {
  kind: "collapsed";
  startLine: number;
  endLine: number;
  count: number;
}

export interface DiffLineRow {
  kind: "line";
  data: DiffLineData;
}

export type VirtualRow = DiffLineRow | CollapsedSectionRow;
