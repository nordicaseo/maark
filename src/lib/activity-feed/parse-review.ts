// ── Review Payload Parser ──────────────────────────────────────
// Extracts structured content from review/artifact event payloads.
// Pure function — no React, no side effects.

// ── Types ──────────────────────────────────────────────────────

export interface ReviewMetric {
  label: string;
  value: string;
  color?: string;
}

export interface ChecklistItem {
  text: string;
  checked: boolean;
}

export interface ParsedReview {
  strengths: string[];
  blockers: string[];
  metrics: ReviewMetric[];
  checklist: ChecklistItem[];
  rawText?: string;
}

// ── Indicator patterns ─────────────────────────────────────────

const POSITIVE_PATTERNS = [
  /^[+✓✅]/,
  /^strength/i,
  /^good/i,
  /^positive/i,
  /demonstrates/i,
  /effective/i,
  /well[- ]structured/i,
  /strong/i,
];

const NEGATIVE_PATTERNS = [
  /^[-✗❌⚠]/,
  /^issue/i,
  /^blocker/i,
  /^needs?[: ]/i,
  /^problem/i,
  /^concern/i,
  /missing/i,
  /insufficient/i,
  /should\s/i,
  /lacks?[: ]/i,
  /weak/i,
];

function isPositive(line: string): boolean {
  return POSITIVE_PATTERNS.some((p) => p.test(line));
}

function isNegative(line: string): boolean {
  return NEGATIVE_PATTERNS.some((p) => p.test(line));
}

// ── Text-based extraction ──────────────────────────────────────

function parseLines(text: string): Omit<ParsedReview, 'rawText'> {
  const strengths: string[] = [];
  const blockers: string[] = [];
  const checklist: ChecklistItem[] = [];
  const metrics: ReviewMetric[] = [];

  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  for (const line of lines) {
    // Checklist items
    if (/^\[x\]/i.test(line)) {
      checklist.push({ text: line.replace(/^\[x\]\s*/i, ''), checked: true });
      continue;
    }
    if (/^\[\s?\]/.test(line)) {
      checklist.push({ text: line.replace(/^\[\s?\]\s*/, ''), checked: false });
      continue;
    }

    // Metrics embedded in text
    const wordMatch = line.match(/(\d[\d,]*)\s*words/i);
    if (wordMatch) {
      metrics.push({ label: 'Words', value: wordMatch[1] });
    }
    const pctMatch = line.match(/(\d+)%/);
    if (pctMatch && /coverage|score|rating/i.test(line)) {
      metrics.push({ label: 'Score', value: `${pctMatch[1]}%` });
    }

    // Categorize line
    const cleanLine = line
      .replace(/^[+\-✓✗✅❌⚠]\s*/, '')
      .replace(/^(strength|good|positive|issue|blocker|needs?|problem|concern)[: ]\s*/i, '')
      .trim();

    if (!cleanLine) continue;

    if (isPositive(line)) {
      strengths.push(cleanLine);
    } else if (isNegative(line)) {
      blockers.push(cleanLine);
    }
  }

  return { strengths, blockers, metrics, checklist };
}

// ── Structured data extraction ─────────────────────────────────

function parseStructuredData(data: Record<string, unknown>): Omit<ParsedReview, 'rawText'> | null {
  const strengths: string[] = [];
  const blockers: string[] = [];
  const metrics: ReviewMetric[] = [];
  const checklist: ChecklistItem[] = [];

  // Direct arrays
  if (Array.isArray(data.strengths)) {
    for (const s of data.strengths) {
      if (typeof s === 'string') strengths.push(s);
    }
  }
  if (Array.isArray(data.issues)) {
    for (const s of data.issues) {
      if (typeof s === 'string') blockers.push(s);
    }
  }
  if (Array.isArray(data.blockers)) {
    for (const s of data.blockers) {
      if (typeof s === 'string') blockers.push(s);
    }
  }

  // Completion metrics
  const completion = data.completion as Record<string, unknown> | undefined;
  if (completion) {
    if (typeof completion.headingCoverage === 'number') {
      const pct = Math.round(completion.headingCoverage * 100);
      metrics.push({
        label: 'Coverage',
        value: `${pct}%`,
        color: pct < 50 ? '#c55342' : pct < 80 ? '#d19745' : '#3a9567',
      });
    }
    if (typeof completion.wordGap === 'number' && completion.wordGap > 0) {
      metrics.push({
        label: 'Word Gap',
        value: `${completion.wordGap.toLocaleString()}`,
        color: '#c55342',
      });
    }
    if (Array.isArray(completion.missingHeadings) && completion.missingHeadings.length > 0) {
      metrics.push({
        label: 'Missing Sections',
        value: `${completion.missingHeadings.length}`,
        color: '#c55342',
      });
    }
  }

  const hasContent = strengths.length > 0 || blockers.length > 0 || metrics.length > 0;
  if (!hasContent) return null;

  return { strengths, blockers, metrics, checklist };
}

// ── Main parser ────────────────────────────────────────────────

/**
 * Parses review/artifact payload into structured content for rich rendering.
 * Returns null if no structured content could be extracted.
 */
export function parseReviewPayload(
  payload?: Record<string, unknown>,
  summary?: string,
): ParsedReview | null {
  if (!payload && !summary) return null;

  // 1. Try structured data from artifact.data
  if (payload) {
    const artifact = payload.artifact as Record<string, unknown> | undefined;
    if (artifact?.data && typeof artifact.data === 'object') {
      const result = parseStructuredData(artifact.data as Record<string, unknown>);
      if (result) return { ...result, rawText: undefined };
    }
  }

  // 2. Try text from artifact.body
  if (payload) {
    const artifact = payload.artifact as Record<string, unknown> | undefined;
    const body = artifact?.body;
    if (typeof body === 'string' && body.trim().length > 20) {
      const result = parseLines(body);
      if (result.strengths.length > 0 || result.blockers.length > 0 || result.checklist.length > 0) {
        return { ...result, rawText: body };
      }
    }
  }

  // 3. Try summary text as last resort
  if (summary && summary.length > 40) {
    const result = parseLines(summary);
    if (result.strengths.length > 0 || result.blockers.length > 0) {
      return { ...result, rawText: summary };
    }
  }

  return null;
}
