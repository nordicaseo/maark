function stripCodeFences(input: string): string {
  const fenced = input.trim().match(/^```(?:html|markdown)?\s*([\s\S]*?)\s*```$/i);
  if (fenced?.[1]) return fenced[1].trim();
  return input;
}

export function isLikelyHtml(input: string): boolean {
  return /<\s*(p|h1|h2|h3|h4|ul|ol|li|table|thead|tbody|tr|td|th|blockquote|img|a|div|span)\b/i.test(
    input
  );
}

export function textToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  return escaped
    .split(/\n{2,}/)
    .map((chunk) => `<p>${chunk.replace(/\n/g, '<br />')}</p>`)
    .join('\n');
}

function collapseTextNodeWhitespace(html: string): string {
  const chunks = html.split(/(<[^>]+>)/g);
  let preserveWhitespaceDepth = 0;

  return chunks
    .map((chunk) => {
      if (!chunk) return '';
      if (chunk.startsWith('<') && chunk.endsWith('>')) {
        const lower = chunk.toLowerCase();
        const isClosing = /^<\s*\//.test(lower);
        const isSelfClosing = /\/\s*>$/.test(lower);
        const isPreserveOpen = /^<\s*(pre|code)\b/.test(lower);
        const isPreserveClose = /^<\s*\/\s*(pre|code)\s*>/.test(lower);

        if (!isClosing && !isSelfClosing && isPreserveOpen) {
          preserveWhitespaceDepth += 1;
        } else if (isPreserveClose && preserveWhitespaceDepth > 0) {
          preserveWhitespaceDepth -= 1;
        }
        return chunk;
      }

      if (preserveWhitespaceDepth > 0) {
        return chunk;
      }

      return chunk
        .replace(/&nbsp;/gi, ' ')
        .replace(/[ \t\u00a0]{2,}/g, ' ')
        .replace(/\s*\n+\s*/g, ' ');
    })
    .join('');
}

function stripHtmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function countMatches(text: string, regex: RegExp): number {
  return text.match(regex)?.length ?? 0;
}

export interface RevisionValidationResult {
  ok: boolean;
  reason?: string;
  metrics: {
    sourceWordCount: number;
    revisedWordCount: number;
    sourceCharCount: number;
    revisedCharCount: number;
    sourceHeadingCount: number;
    revisedHeadingCount: number;
    sourceStructureCount: number;
    revisedStructureCount: number;
  };
}

export function validateRevisedHtmlOutput(
  sourceHtml: string,
  revisedHtml: string
): RevisionValidationResult {
  const sourceText = stripHtmlToText(sourceHtml);
  const revisedText = stripHtmlToText(revisedHtml);

  const sourceWordCount = countWords(sourceText);
  const revisedWordCount = countWords(revisedText);
  const sourceCharCount = sourceText.length;
  const revisedCharCount = revisedText.length;
  const sourceHeadingCount = countMatches(sourceHtml, /<h[1-6]\b/gi);
  const revisedHeadingCount = countMatches(revisedHtml, /<h[1-6]\b/gi);
  const sourceStructureCount = countMatches(sourceHtml, /<(?:p|li|blockquote|table|tr|td|th)\b/gi);
  const revisedStructureCount = countMatches(revisedHtml, /<(?:p|li|blockquote|table|tr|td|th)\b/gi);

  const metrics = {
    sourceWordCount,
    revisedWordCount,
    sourceCharCount,
    revisedCharCount,
    sourceHeadingCount,
    revisedHeadingCount,
    sourceStructureCount,
    revisedStructureCount,
  };

  if (!revisedText) {
    return { ok: false, reason: 'AI returned empty revised content.', metrics };
  }

  if (/<[^>]*$/.test(revisedHtml.trim())) {
    return { ok: false, reason: 'AI output appears to have incomplete HTML.', metrics };
  }

  if (sourceWordCount >= 120) {
    const minimumWords = Math.max(40, Math.floor(sourceWordCount * 0.6));
    if (revisedWordCount < minimumWords) {
      return {
        ok: false,
        reason: `AI output appears truncated (${revisedWordCount}/${sourceWordCount} words).`,
        metrics,
      };
    }
  }

  if (sourceCharCount >= 900) {
    const minimumChars = Math.floor(sourceCharCount * 0.55);
    if (revisedCharCount < minimumChars) {
      return {
        ok: false,
        reason: `AI output appears truncated (${revisedCharCount}/${sourceCharCount} chars).`,
        metrics,
      };
    }
  }

  if (sourceHeadingCount >= 2) {
    const minimumHeadings = Math.max(1, Math.floor(sourceHeadingCount * 0.5));
    if (revisedHeadingCount < minimumHeadings) {
      return {
        ok: false,
        reason: 'AI output dropped too much heading structure.',
        metrics,
      };
    }
  }

  if (sourceStructureCount >= 10) {
    const minimumStructure = Math.floor(sourceStructureCount * 0.4);
    if (revisedStructureCount < minimumStructure) {
      return {
        ok: false,
        reason: 'AI output dropped too much document structure.',
        metrics,
      };
    }
  }

  return { ok: true, metrics };
}

export function normalizeGeneratedHtml(input: string): string {
  const withoutFences = stripCodeFences(input);
  let html = withoutFences
    .replace(/\r\n/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/\u200b/g, '')
    .replace(/(?:&nbsp;\s*){2,}/gi, ' ')
    .replace(/<p>(?:\s|&nbsp;|<br\s*\/?>)*<\/p>/gi, '')
    .replace(/<div>(?:\s|&nbsp;|<br\s*\/?>)*<\/div>/gi, '')
    .replace(/(?:<br\s*\/?>\s*){3,}/gi, '<br /><br />')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!isLikelyHtml(html)) {
    html = textToHtml(html);
  } else {
    html = collapseTextNodeWhitespace(html)
      .replace(/>\s+</g, '><')
      .replace(/<p>(?:\s|&nbsp;|<br\s*\/?>)*<\/p>/gi, '')
      .replace(/<div>(?:\s|&nbsp;|<br\s*\/?>)*<\/div>/gi, '')
      .replace(/(?:<br\s*\/?>\s*){3,}/gi, '<br /><br />')
      .trim();
  }

  return html;
}
