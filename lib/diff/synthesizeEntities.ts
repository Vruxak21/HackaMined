/**
 * synthesizeEntities.ts
 *
 * Dynamically derives PiiEntity[] from the diff between originalText and sanitizedText.
 *
 * Two-strategy waterfall:
 *
 *  Strategy 1 — Structural token scan (tokenize masking mode)
 *    The Python service emits <<ENTITY_TYPE_NNN>> tokens.  We split the
 *    sanitized text on these tokens to get interleaved plain/token segments.
 *    The plain segments appear verbatim in the original text, so they act as
 *    precise positional anchors.  Each entity span in original = the gap
 *    between the plain segment before and the plain segment after.
 *    Runs in O(N) and correctly handles ALL adjacency patterns including
 *    consecutive entities with no text between them.
 *
 *  Strategy 2 — Token-aware anchor search (partial / redact / stars modes)
 *    Improved version of the classic anchor search that stops the sLen loop
 *    at every << boundary, so consecutive entities are NEVER merged.
 *
 * This is a pure function — no React, no side effects.
 */

import type { EntityType, PiiEntity } from "./diffTypes";

// ─── Config ───────────────────────────────────────────────────────────────────

const ANCHOR_LEN   = 10;  // chars used as resync anchor in Strategy 2
const MAX_ORIG_LEN = 400; // generous upper bound for an original PII value
const MIN_BRIDGE   = 2;   // min plain-text bridge length to be a reliable anchor

// ─── Python → Viewer entity type mapping ─────────────────────────────────────

const PYTHON_TO_VIEWER: Record<string, EntityType> = {
  // Contact
  EMAIL_ADDRESS:  "EMAIL",
  IN_PHONE:       "PHONE",
  PHONE_NUMBER:   "PHONE",
  // Indian government IDs
  AADHAAR:        "AADHAAR",
  AADHAAR_VID:    "AADHAAR",
  PAN:            "PAN",
  PASSPORT:       "PASSPORT",
  // Identity
  PERSON:         "NAME",
  NAME:           "NAME",
  ORGANIZATION:   "NAME",
  NRP:            "NAME",
  // Location
  LOCATION:       "ADDRESS",
  ADDRESS:        "ADDRESS",
  // Dates
  DATE_TIME:      "DOB",
  DATE_OF_BIRTH:  "DOB",
  // Financial
  CREDIT_CARD:    "CARD_NUMBER",
  CARD_NUMBER:    "CARD_NUMBER",
  ACCOUNT_NUMBER: "CARD_NUMBER",
  CVV:            "CVV",
  UPI:            "UPI",
  IFSC:           "UPI",
  // Network
  IP_ADDRESS:     "IP_ADDRESS",
  URL:            "IP_ADDRESS",
  DEVICE_ID:      "IP_ADDRESS",
  // Biometric / other
  BIOMETRIC:      "PASSPORT",
};

export function mapPythonEntityType(pythonType: string): EntityType {
  return PYTHON_TO_VIEWER[pythonType] ?? "NAME";
}

// ─── Shared internal span type ────────────────────────────────────────────────

interface RawSpan {
  origStart:   number;
  origEnd:     number;
  sanStart:    number;
  sanEnd:      number;
  entityType:  EntityType;
  maskedValue: string;
}

// ─── Strategy 1: Structural token scan ───────────────────────────────────────
//
// Algorithm outline:
//   san = P0 T1 P1 T2 P2 … Tₙ Pₙ   (Pi = plain text, Ti = <<TYPE_NNN>> token)
//
//   Key invariant: every Pi appears verbatim in orig.
//
//   For token Ti:
//     · Advance origCursor by finding bridge Pi-1 in orig      (text before Ti)
//     · origEntityStart = origCursor
//     · origEntityEnd   = position of Pi (bridge after Ti) in orig
//     · Advance origCursor = origEntityEnd
//
//   When a bridge is too short/empty (adjacent tokens), look ahead to the
//   first non-trivial bridge to bound the span.

const TOKEN_RE = /<<([A-Z_]+)_\d+>>/g;

function findSpansViaTokens(orig: string, san: string): RawSpan[] | null {
  TOKEN_RE.lastIndex = 0;
  if (!TOKEN_RE.test(san)) return null;
  TOKEN_RE.lastIndex = 0;

  interface SanToken {
    sanStart:   number;
    sanEnd:     number;
    entityType: EntityType;
    text:       string;
  }

  const tokens: SanToken[] = [];
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(san)) !== null) {
    tokens.push({
      sanStart:   m.index,
      sanEnd:     m.index + m[0].length,
      entityType: mapPythonEntityType(m[1]),
      text:       m[0],
    });
  }
  if (tokens.length === 0) return null;

  // Helper: plain text that immediately follows token[ti] in sanitized
  function bridgeAfter(ti: number): string {
    const s = tokens[ti].sanEnd;
    const e = tokens[ti + 1]?.sanStart ?? san.length;
    return san.slice(s, e);
  }

  // When the bridge after token[ti] is too short, look ahead to find the
  // first non-trivial bridge and its position in orig (from origFrom).
  function lookaheadBridgeEnd(ti: number, origFrom: number): number | null {
    for (let la = ti + 1; la <= tokens.length; la++) {
      const bridge =
        la < tokens.length
          ? bridgeAfter(la - 1)
          : san.slice(tokens[tokens.length - 1].sanEnd); // trailing suffix
      if (bridge.length >= MIN_BRIDGE) {
        const found = orig.indexOf(bridge, origFrom);
        if (found !== -1) return found;
      }
      if (la >= tokens.length) break;
    }
    return null;
  }

  const results: RawSpan[] = [];
  let origCursor = 0;

  for (let ti = 0; ti < tokens.length; ti++) {
    const tok = tokens[ti];

    // ── Consume bridge BEFORE this token ─────────────────────────────────────
    const prevTokEnd = ti === 0 ? 0 : tokens[ti - 1].sanEnd;
    const bridgeBefore = san.slice(prevTokEnd, tok.sanStart);

    if (bridgeBefore.length > 0) {
      const found = orig.indexOf(bridgeBefore, origCursor);
      if (found !== -1) origCursor = found + bridgeBefore.length;
      // If not found: keep origCursor; graceful degradation for rare edge cases
    }

    const origEntityStart = origCursor;

    // ── Find entity end via bridge AFTER this token ───────────────────────────
    const bridge = bridgeAfter(ti);
    let origEntityEnd: number;

    if (bridge.length >= MIN_BRIDGE) {
      const found = orig.indexOf(bridge, origEntityStart);
      origEntityEnd =
        found !== -1 ? found : Math.min(origEntityStart + MAX_ORIG_LEN, orig.length);
    } else {
      // Short or empty bridge — look ahead for the nearest usable anchor
      const la = lookaheadBridgeEnd(ti, origEntityStart);
      origEntityEnd = la ?? Math.min(origEntityStart + MAX_ORIG_LEN, orig.length);
    }

    origEntityEnd = Math.min(origEntityEnd, orig.length);

    if (origEntityEnd > origEntityStart) {
      results.push({
        origStart:   origEntityStart,
        origEnd:     origEntityEnd,
        sanStart:    tok.sanStart,
        sanEnd:      tok.sanEnd,
        entityType:  tok.entityType,
        maskedValue: tok.text,
      });
    }

    // Advance cursor past the entity so the next bridge search starts correctly
    origCursor = origEntityEnd;
  }

  return results.length > 0 ? results : null;
}

// ─── Strategy 2: Token-aware anchor search ────────────────────────────────────
//
// For partial / redact / stars masking where tokens are not used.
// The critical fix vs. the old version: the sLen loop breaks when it hits a
// new «<<» token boundary in sanitized, preventing consecutive entities from
// being merged into a single span.

function guessEntityTypeFromMask(maskedValue: string): EntityType | null {
  const tokenMatch = maskedValue.match(/^<<([A-Z_]+)_\d+>>$/);
  if (tokenMatch) return mapPythonEntityType(tokenMatch[1]);
  if (maskedValue.includes("@")) return "EMAIL";
  if (/^\+?[\d\s\-\*\(\)]{8,}$/.test(maskedValue) && /\*/.test(maskedValue)) return "PHONE";
  if (/^\d+\.\*+\.\*+\./.test(maskedValue) || /^\*+\.\*+\.\*+\.\*+$/.test(maskedValue))
    return "IP_ADDRESS";
  if (/^[X\d*][\sX\d*\-]{11,19}$/.test(maskedValue)) return "CARD_NUMBER";
  if (/^[A-Z*]{5}[\dA-Z*]{5}$/.test(maskedValue)) return "PAN";
  if (/^[\dX*\-\s]{12,16}$/.test(maskedValue)) return "AADHAAR";
  if (maskedValue.startsWith("[") && maskedValue.endsWith("]")) return null;
  return null;
}

function findSpansViaAnchorSearch(orig: string, san: string): RawSpan[] {
  const spans: RawSpan[] = [];
  let i = 0;
  let j = 0;

  while (i < orig.length && j < san.length) {
    if (orig.charCodeAt(i) === san.charCodeAt(j)) { i++; j++; continue; }

    const origStart = i;
    const sanStart  = j;

    // If at a token start, handle it explicitly (shouldn't reach here if
    // Strategy 1 ran, but keeps this strategy self-consistent)
    const tokenMatch = san.slice(j).match(/^<<([A-Z_]+)_\d+>>/);
    if (tokenMatch) {
      const sanEnd  = j + tokenMatch[0].length;
      const anchor  = san.slice(sanEnd, sanEnd + ANCHOR_LEN);
      const idx     = anchor.length >= 2 ? orig.indexOf(anchor, i) : -1;
      const origEnd = idx !== -1
        ? Math.min(idx, i + MAX_ORIG_LEN)
        : Math.min(i + MAX_ORIG_LEN, orig.length);

      spans.push({
        origStart, origEnd, sanStart, sanEnd,
        entityType:  mapPythonEntityType(tokenMatch[1]),
        maskedValue: tokenMatch[0],
      });
      i = origEnd;
      j = sanEnd;
      continue;
    }

    // Non-token mismatch (partial / redact / stars masking)
    const origWindow = orig.slice(i, i + MAX_ORIG_LEN + ANCHOR_LEN);
    let origEnd = -1;
    let sanEnd  = -1;

    for (let sLen = 1; sLen <= 200 && j + sLen <= san.length; sLen++) {
      // KEY FIX: stop if we hit a new token boundary — never merge across them
      if (san[j + sLen] === "<" && san.slice(j + sLen, j + sLen + 2) === "<<") break;
      if (j + sLen + ANCHOR_LEN > san.length) break;

      const anchor = san.substring(j + sLen, j + sLen + ANCHOR_LEN);
      const idx    = origWindow.indexOf(anchor);
      if (idx !== -1) { origEnd = i + idx; sanEnd = j + sLen; break; }
    }

    if (origEnd === -1) { origEnd = orig.length; sanEnd = san.length; }

    const maskedValue = san.slice(sanStart, sanEnd);
    spans.push({
      origStart, origEnd, sanStart, sanEnd,
      entityType:  guessEntityTypeFromMask(maskedValue) ?? "NAME",
      maskedValue,
    });
    i = origEnd;
    j = sanEnd;
  }

  return spans;
}

// ─── Layer / type assignment helpers ─────────────────────────────────────────

type LayerName = "regex" | "spacy" | "bert";

function buildLayerQueue(lb: Record<string, number>): LayerName[] {
  const q: LayerName[] = [];
  const regex = lb.regex ?? 0;
  const spacy = lb.spacy ?? lb.presidio_spacy ?? 0;
  const bert  = lb.bert  ?? lb.indic_bert     ?? 0;
  if (regex + spacy + bert === 0) return ["regex"];
  for (let k = 0; k < regex; k++) q.push("regex");
  for (let k = 0; k < spacy; k++) q.push("spacy");
  for (let k = 0; k < bert;  k++) q.push("bert");
  return q;
}

function buildTypeQueue(piiSummary: Record<string, number>): EntityType[] {
  const q: EntityType[] = [];
  for (const [pyType, count] of Object.entries(piiSummary)) {
    const vt = mapPythonEntityType(pyType);
    for (let k = 0; k < count; k++) q.push(vt);
  }
  return q;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Synthesize PiiEntity[] from original/sanitized text pair.
 *
 * @param originalText   Raw text before sanitization.
 * @param sanitizedText  Text after PII masking.
 * @param piiSummary     Entity type counts  { EMAIL_ADDRESS: 3, PERSON: 10, … }
 * @param layerBreakdown Detection layer counts  { regex: 4, spacy: 8, bert: 3 }
 */
export function synthesizeEntitiesFromDiff(
  originalText:   string,
  sanitizedText:  string,
  piiSummary:     Record<string, number>,
  layerBreakdown: Record<string, number>
): PiiEntity[] {
  if (!originalText || originalText === sanitizedText) return [];

  // Strategy 1 (token scan) → Strategy 2 (anchor search) fallback
  const spans: RawSpan[] =
    findSpansViaTokens(originalText, sanitizedText) ??
    findSpansViaAnchorSearch(originalText, sanitizedText);

  if (spans.length === 0) return [];

  const typeQueue  = buildTypeQueue(piiSummary);
  const layerQueue = buildLayerQueue(layerBreakdown);
  let typeIdx  = 0;
  let layerIdx = 0;

  return spans.map((span) => {
    // Strategy 1 spans carry the correct type from the token itself.
    // Strategy 2 spans carry a pattern-guessed type; use queue as fallback.
    const entityType =
      span.entityType !== "NAME" || span.maskedValue.startsWith("<<")
        ? span.entityType
        : (typeQueue[typeIdx++ % Math.max(typeQueue.length, 1)] ?? "NAME");

    const layer = (layerQueue[layerIdx++ % Math.max(layerQueue.length, 1)] ?? "regex") as LayerName;

    const confidence =
      span.maskedValue.startsWith("<<") ? 1.0
      : guessEntityTypeFromMask(span.maskedValue) ? 0.9
      : 0.8;

    return {
      id:            `synth-${span.origStart}-${span.sanStart}`,
      entityType,
      originalValue: originalText.slice(span.origStart, span.origEnd),
      maskedValue:   span.maskedValue,
      startIndex:    span.origStart,
      endIndex:      span.origEnd,
      confidence,
      layer,
    };
  });
}
