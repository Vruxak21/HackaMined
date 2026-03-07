import type { DiffLineData, PiiEntity, Segment, VirtualRow } from "./diffTypes";

// Number of context lines around a changed section before collapsing
const COLLAPSE_THRESHOLD = 5;

// ─── Build per-character entity map for a side ───────────────────────────────

interface CharEntity {
  entityId: string;
  entityType: string;
  isMasked: boolean;
}

function buildCharMap(
  text: string,
  entities: PiiEntity[],
  side: "original" | "sanitized"
): (CharEntity | null)[] {
  const map: (CharEntity | null)[] = new Array(text.length).fill(null);
  for (const entity of entities) {
    if (side === "original") {
      for (let i = entity.startIndex; i < entity.endIndex && i < text.length; i++) {
        map[i] = { entityId: entity.id, entityType: entity.entityType, isMasked: false };
      }
    }
  }
  return map;
}

// ─── Tokenize a single line into segments ────────────────────────────────────

function segmentizeLine(
  lineText: string,
  lineStartOffset: number,
  charMap: (CharEntity | null)[]
): Segment[] {
  const segments: Segment[] = [];
  let i = 0;

  while (i < lineText.length) {
    const globalIdx = lineStartOffset + i;
    const charEntity = globalIdx < charMap.length ? charMap[globalIdx] : null;

    if (charEntity) {
      // Consume all chars belonging to this entity
      const startI = i;
      const targetId = charEntity.entityId;
      while (
        i < lineText.length &&
        globalIdx + (i - startI) < charMap.length &&
        charMap[lineStartOffset + i]?.entityId === targetId
      ) {
        i++;
      }
      segments.push({
        text: lineText.slice(startI, i),
        isPii: true,
        entityType: charEntity.entityType as never,
        entityId: charEntity.entityId,
        isMasked: charEntity.isMasked,
      });
    } else {
      // Consume plain text until next entity (or end)
      const startI = i;
      while (i < lineText.length) {
        const gi = lineStartOffset + i;
        if (gi < charMap.length && charMap[gi]) break;
        i++;
      }
      const chunk = lineText.slice(startI, i);
      if (chunk.length > 0) {
        segments.push({ text: chunk, isPii: false });
      }
    }
  }

  return segments;
}

// ─── Build sanitized char map using entity positions in the original ─────────
// We reconstruct the sanitized string character map by mapping entity positions
// through the entity list: we need to find each maskedValue span in sanitizedText.

function buildSanitizedCharMap(
  sanitizedText: string,
  entities: PiiEntity[]
): (CharEntity | null)[] {
  const map: (CharEntity | null)[] = new Array(sanitizedText.length).fill(null);

  // We'll find masked values in sanitized text using a simple sequential scan.
  // Because the sanitized text replaces each entity's originalValue with maskedValue
  // in order, we can track the offset delta.
  let offset = 0; // current position in sanitizedText we're examining

  // Sort entities by startIndex to process them in order
  const sorted = [...entities].sort((a, b) => a.startIndex - b.startIndex);

  for (const entity of sorted) {
    const masked = entity.maskedValue;
    // Find this masked value near expected position (allow drift for multi-entity edits)
    const searchStart = Math.max(0, offset);
    const foundAt = sanitizedText.indexOf(masked, searchStart);
    if (foundAt === -1) continue;

    for (let i = foundAt; i < foundAt + masked.length && i < sanitizedText.length; i++) {
      map[i] = { entityId: entity.id, entityType: entity.entityType, isMasked: true };
    }
    offset = foundAt + masked.length;
  }

  return map;
}

// ─── Main export ─────────────────────────────────────────────────────────────

export function buildDiffLines(
  originalText: string,
  sanitizedText: string,
  piiEntities: PiiEntity[]
): DiffLineData[] {
  const origLines = originalText.split("\n");
  const sanLines = sanitizedText.split("\n");
  const totalLines = Math.max(origLines.length, sanLines.length);

  // Build per-character entity maps for both sides
  const origCharMap = buildCharMap(originalText, piiEntities, "original");
  const sanCharMap = buildSanitizedCharMap(sanitizedText, piiEntities);

  // Compute line start offsets in the original text
  const origLineOffsets: number[] = [];
  let pos = 0;
  for (const line of origLines) {
    origLineOffsets.push(pos);
    pos += line.length + 1; // +1 for '\n'
  }

  const sanLineOffsets: number[] = [];
  pos = 0;
  for (const line of sanLines) {
    sanLineOffsets.push(pos);
    pos += line.length + 1;
  }

  const result: DiffLineData[] = [];

  for (let i = 0; i < totalLines; i++) {
    const origLine = origLines[i] ?? "";
    const sanLine = sanLines[i] ?? "";
    const origOffset = origLineOffsets[i] ?? 0;
    const sanOffset = sanLineOffsets[i] ?? 0;

    const originalSegments = segmentizeLine(origLine, origOffset, origCharMap);
    const sanitizedSegments = segmentizeLine(sanLine, sanOffset, sanCharMap);

    const hasChanges =
      originalSegments.some((s) => s.isPii) ||
      sanitizedSegments.some((s) => s.isPii);

    result.push({
      lineNumber: i + 1,
      originalSegments,
      sanitizedSegments,
      hasChanges,
    });
  }

  return result;
}

// ─── Build virtual rows (with collapsed sections) ────────────────────────────

export function buildVirtualRows(
  diffLines: DiffLineData[],
  expandedSections: Set<number>
): VirtualRow[] {
  const rows: VirtualRow[] = [];
  let i = 0;

  while (i < diffLines.length) {
    const line = diffLines[i];

    if (!line.hasChanges) {
      // Look ahead to find how many consecutive unchanged lines follow
      let j = i;
      while (j < diffLines.length && !diffLines[j].hasChanges) {
        j++;
      }
      const count = j - i;

      // Don't collapse at very start or very end
      const atStart = i === 0;
      const atEnd = j === diffLines.length;

      if (!atStart && !atEnd && count > COLLAPSE_THRESHOLD) {
        // Leave first 3 and last 3 as context
        const CONTEXT = 3;
        // Show first CONTEXT lines
        for (let k = i; k < i + CONTEXT && k < j; k++) {
          rows.push({ kind: "line", data: diffLines[k] });
        }
        // Collapsed section
        const collapseStart = i + CONTEXT;
        const collapseEnd = j - CONTEXT - 1;
        const sectionKey = collapseStart;
        const collapseCount = collapseEnd - collapseStart + 1;

        if (collapseCount > 0) {
          if (expandedSections.has(sectionKey)) {
            // Show all lines
            for (let k = collapseStart; k <= collapseEnd; k++) {
              rows.push({ kind: "line", data: diffLines[k] });
            }
          } else {
            rows.push({
              kind: "collapsed",
              startLine: diffLines[collapseStart].lineNumber,
              endLine: diffLines[collapseEnd].lineNumber,
              count: collapseCount,
            });
          }
        }
        // Show last CONTEXT lines
        for (let k = j - CONTEXT; k < j; k++) {
          if (k >= collapseStart + (expandedSections.has(sectionKey) ? collapseCount : 0)) {
            rows.push({ kind: "line", data: diffLines[k] });
          } else if (k >= i + CONTEXT) {
            rows.push({ kind: "line", data: diffLines[k] });
          }
        }
        i = j;
      } else {
        // Short run or at boundary — show all
        for (let k = i; k < j; k++) {
          rows.push({ kind: "line", data: diffLines[k] });
        }
        i = j;
      }
    } else {
      rows.push({ kind: "line", data: line });
      i++;
    }
  }

  return rows;
}

// ─── Filter entities by active type ──────────────────────────────────────────

export function getVisibleEntities(
  entities: PiiEntity[],
  activeFilter: string | null
): PiiEntity[] {
  if (!activeFilter) return entities;
  return entities.filter((e) => e.entityType === activeFilter);
}

// ─── Find occurrences of the same original value ──────────────────────────────

export function findOccurrences(
  entities: PiiEntity[],
  entity: PiiEntity
): PiiEntity[] {
  return entities.filter(
    (e) => e.originalValue === entity.originalValue && e.entityType === entity.entityType
  );
}

// ─── Which line number contains a given entity (1-based) ─────────────────────

export function getEntityLineNumber(
  entity: PiiEntity,
  originalText: string
): number {
  const before = originalText.slice(0, entity.startIndex);
  return before.split("\n").length;
}
