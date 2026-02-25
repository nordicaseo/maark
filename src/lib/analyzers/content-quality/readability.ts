function countSyllables(word: string): number {
  word = word.toLowerCase().replace(/[^a-z]/g, '');
  if (word.length <= 3) return 1;

  word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '');
  word = word.replace(/^y/, '');
  const matches = word.match(/[aeiouy]{1,2}/g);
  return matches ? matches.length : 1;
}

export function analyzeReadability(text: string) {
  const sentences = text
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const words = text
    .split(/\s+/)
    .filter((w) => w.length > 0);

  if (words.length < 10) {
    return {
      score: 50,
      gradeLevel: 0,
      avgSentenceLength: 0,
      avgSyllablesPerWord: 0,
    };
  }

  const totalSyllables = words.reduce((sum, w) => sum + countSyllables(w), 0);
  const avgSentenceLength = words.length / Math.max(1, sentences.length);
  const avgSyllablesPerWord = totalSyllables / words.length;

  // Flesch-Kincaid Grade Level
  const gradeLevel =
    0.39 * avgSentenceLength + 11.8 * avgSyllablesPerWord - 15.59;

  // Flesch Reading Ease (0-100, higher is easier)
  const readingEase =
    206.835 - 1.015 * avgSentenceLength - 84.6 * avgSyllablesPerWord;

  // Convert to a 0-100 quality score
  // Ideal reading ease for web content: 60-80
  let score: number;
  if (readingEase >= 60 && readingEase <= 80) {
    score = 90 + (readingEase - 60) * 0.5; // 90-100
  } else if (readingEase >= 50 && readingEase < 60) {
    score = 70 + (readingEase - 50); // 70-80
  } else if (readingEase >= 30 && readingEase < 50) {
    score = 40 + (readingEase - 30) * 1.5; // 40-70
  } else if (readingEase < 30) {
    score = Math.max(10, readingEase);
  } else {
    // > 80, too simple
    score = Math.max(50, 90 - (readingEase - 80) * 0.5);
  }

  return {
    score: Math.round(Math.min(100, Math.max(0, score))),
    gradeLevel: Math.max(0, gradeLevel),
    avgSentenceLength,
    avgSyllablesPerWord,
  };
}
