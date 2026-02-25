const WORD_COUNT_TARGETS: Record<string, { min: number; max: number }> = {
  blog_post: { min: 1200, max: 2500 },
  product_review: { min: 1000, max: 2000 },
  how_to_guide: { min: 1500, max: 3000 },
  listicle: { min: 800, max: 2000 },
  comparison: { min: 1500, max: 3000 },
  news_article: { min: 500, max: 1200 },
};

export function analyzeCompleteness(text: string, contentType: string) {
  const words = text.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const target = WORD_COUNT_TARGETS[contentType] || { min: 1000, max: 2500 };

  const suggestions: string[] = [];
  let score = 70;

  // Word count scoring
  if (wordCount >= target.min && wordCount <= target.max) {
    score += 25;
  } else if (wordCount < target.min) {
    const ratio = wordCount / target.min;
    if (ratio < 0.3) {
      score -= 30;
      suggestions.push(
        `Content is very short (${wordCount} words). Target: ${target.min}-${target.max} words`
      );
    } else if (ratio < 0.6) {
      score -= 15;
      suggestions.push(
        `Content needs more depth (${wordCount}/${target.min} minimum words)`
      );
    } else {
      score += 5;
      suggestions.push(
        `Almost at target length (${wordCount}/${target.min} words)`
      );
    }
  } else {
    // Over target
    const overRatio = wordCount / target.max;
    if (overRatio > 1.5) {
      score -= 10;
      suggestions.push(
        `Content may be too long (${wordCount} words, target max: ${target.max}). Consider trimming`
      );
    } else {
      score += 15;
    }
  }

  // Check for an intro and conclusion
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (paragraphs.length < 3 && wordCount > 200) {
    suggestions.push('Add more paragraphs for better content structure');
    score -= 10;
  }

  return {
    score: Math.round(Math.min(100, Math.max(0, score))),
    wordCount,
    targetMin: target.min,
    targetMax: target.max,
    suggestions,
  };
}
