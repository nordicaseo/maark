export interface OutlineGapDiagnostic {
  expectedHeadings: number;
  coveredHeadings: number;
  missingHeadings: string[];
  coverage: number;
}

export interface WritingCompletenessResult {
  complete: boolean;
  reasons: string[];
  wordCount: number;
  minWords: number;
  maxWords: number;
  wordGap: number;
  wordOverflow: number;
  headingCoverage: number;
  missingHeadings: string[];
  abruptEnding: boolean;
  outlineGap: OutlineGapDiagnostic;
}

export interface ContinuationResult {
  html: string;
  plainText: string;
  attempts: number;
  completion: WritingCompletenessResult;
}

function normalizeHeading(value: string): string {
  return value
    .toLowerCase()
    .replace(/<[^>]*>/g, " ")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractOutlineHeadings(markdown: string): string[] {
  return markdown
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("## "))
    .map((line) => line.replace(/^##\s+/, "").trim())
    .filter(Boolean);
}

function extractDraftHeadings(html: string): string[] {
  const headings: string[] = [];
  const matches = html.matchAll(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/gi);
  for (const match of matches) {
    const text = normalizeHeading(match[1] || "");
    if (text) headings.push(text);
  }
  return headings;
}

function hasAbruptEnding(plainText: string): boolean {
  const trimmed = plainText.trim();
  if (!trimmed) return true;
  if (/(to be continued|continue in next)/i.test(trimmed)) return true;
  const tail = trimmed.slice(-220);
  if (!/[.!?]["')\]]?\s*$/.test(tail)) return true;
  if (/[,:;(\-]\s*$/.test(trimmed)) return true;
  return false;
}

export function stripHtmlForCompleteness(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function evaluateWritingCompleteness(args: {
  html: string;
  plainText?: string;
  outlineHeadings: string[];
  minimumWords?: number;
  maximumWords?: number;
}): WritingCompletenessResult {
  const plainText = (args.plainText || stripHtmlForCompleteness(args.html)).trim();
  const normalizedOutline = args.outlineHeadings.map(normalizeHeading).filter(Boolean);
  const draftHeadings = extractDraftHeadings(args.html);
  const missingHeadings: string[] = [];

  for (const expectedHeading of normalizedOutline) {
    const present = draftHeadings.some(
      (actualHeading) =>
        actualHeading.includes(expectedHeading) ||
        expectedHeading.includes(actualHeading)
    );
    if (!present) {
      missingHeadings.push(expectedHeading);
    }
  }

  const wordCount = plainText.split(/\s+/).filter(Boolean).length;
  const minWords =
    args.minimumWords ?? Math.max(650, normalizedOutline.length * 140);
  const maxWords = Math.max(minWords, args.maximumWords ?? minWords + 2400);
  const headingCoverage =
    normalizedOutline.length === 0
      ? 0
      : (normalizedOutline.length - missingHeadings.length) / normalizedOutline.length;
  const abruptEnding = hasAbruptEnding(plainText);

  const reasons: string[] = [];
  if (wordCount < minWords) {
    reasons.push(`word count ${wordCount} is below minimum ${minWords}`);
  }
  if (wordCount > maxWords) {
    reasons.push(`word count ${wordCount} exceeds maximum ${maxWords}`);
  }
  if (normalizedOutline.length > 0 && headingCoverage < 0.50) {
    reasons.push(
      `heading coverage ${(headingCoverage * 100).toFixed(0)}% is below 50%`
    );
  }
  if (abruptEnding) {
    reasons.push("draft ending appears abrupt or incomplete");
  }

  const outlineGap: OutlineGapDiagnostic = {
    expectedHeadings: normalizedOutline.length,
    coveredHeadings: Math.max(0, normalizedOutline.length - missingHeadings.length),
    missingHeadings,
    coverage: headingCoverage,
  };

  return {
    complete: reasons.length === 0,
    reasons,
    wordCount,
    minWords,
    maxWords,
    wordGap: Math.max(0, minWords - wordCount),
    wordOverflow: Math.max(0, wordCount - maxWords),
    headingCoverage,
    missingHeadings,
    abruptEnding,
    outlineGap,
  };
}

export function buildContinuationPrompt(args: {
  reasons: string[];
  missingHeadings: string[];
  currentHtml: string;
}): string {
  return `The draft appears incomplete.
Known issues: ${args.reasons.join("; ") || "Missing completion checks"}.
Missing headings: ${args.missingHeadings.slice(0, 8).join(", ") || "none"}.

Current draft HTML:
${args.currentHtml}

Continue the article from where it stopped and finish all remaining sections.
Critical rules:
- Do NOT restart from the beginning.
- Do NOT repeat the title or earlier sections.
- If headings are missing, add them exactly and complete those sections.
- End with a proper conclusion and a final complete sentence.

Return HTML only for continuation content, with no preface or commentary.`;
}

export function buildEndingCompletionPrompt(args: {
  currentHtml: string;
}): string {
  return `The article is mostly complete but the ending appears abrupt.

Current draft HTML:
${args.currentHtml}

Write only the missing final ending:
- 1 concise concluding paragraph (3-6 sentences),
- optional final bullet list (max 3 bullets) if helpful,
- end with a complete final sentence and punctuation.
- no title, no repeated opening sections, no markdown.

Return HTML only for the ending addition.`;
}
