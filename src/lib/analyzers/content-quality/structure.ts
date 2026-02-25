export function analyzeStructure(text: string) {
  const lines = text.split('\n');
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  // Count headings (markdown-style or just capitalized short lines)
  const headings = lines.filter(
    (l) => l.match(/^#{1,6}\s/) || (l.length < 80 && l.length > 3 && l === l.trim() && !l.endsWith('.'))
  );

  const hasH1 =
    lines.some((l) => l.match(/^#\s/)) ||
    (paragraphs.length > 0 && paragraphs[0].split(/\s+/).length < 15);

  const paraLengths = paragraphs.map(
    (p) => p.split(/\s+/).filter(Boolean).length
  );
  const avgParagraphLength =
    paraLengths.length > 0
      ? paraLengths.reduce((a, b) => a + b, 0) / paraLengths.length
      : 0;

  const suggestions: string[] = [];
  let score = 70;

  // Heading checks
  if (headings.length === 0 && paragraphs.length > 3) {
    suggestions.push('Add headings to break up content into sections');
    score -= 20;
  } else if (headings.length >= 2) {
    score += 10;
  }

  if (!hasH1) {
    suggestions.push('Add a main title (H1 heading)');
    score -= 10;
  }

  // Paragraph length checks
  const longParas = paraLengths.filter((l) => l > 150).length;
  if (longParas > 0) {
    suggestions.push(
      `${longParas} paragraph${longParas > 1 ? 's are' : ' is'} too long (150+ words) - consider splitting`
    );
    score -= longParas * 5;
  }

  const shortParas = paraLengths.filter((l) => l < 10 && l > 0).length;
  if (shortParas > paragraphs.length * 0.5 && paragraphs.length > 3) {
    suggestions.push('Many paragraphs are very short - consider combining some');
    score -= 10;
  }

  // Variety: does it use lists?
  const hasList = text.includes('- ') || text.includes('* ') || /\d+\.\s/.test(text);
  if (!hasList && paragraphs.length > 5) {
    suggestions.push('Consider adding bullet points or lists for key information');
    score -= 5;
  }

  return {
    score: Math.round(Math.min(100, Math.max(0, score))),
    headingCount: headings.length,
    paragraphCount: paragraphs.length,
    hasH1,
    avgParagraphLength: Math.round(avgParagraphLength),
    suggestions,
  };
}
