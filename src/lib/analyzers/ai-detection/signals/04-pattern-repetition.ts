import { SignalResult } from '../types';
import { tokenizeWords } from '../utils';

export function signal04PatternRepetition(
  text: string,
  sentences: string[],
  words: string[],
  paragraphs: string[]
): Omit<SignalResult, 'weight'> {
  if (sentences.length < 4) {
    return {
      signalId: 4,
      name: 'Pattern Repetition Audit',
      score: 3,
      detail: 'Too few sentences for pattern analysis.',
      examples: [],
    };
  }

  const openings: string[] = sentences.map((s) =>
    tokenizeWords(s).slice(0, 3).join(' ')
  );

  const openingCounts: Record<string, number> = {};
  for (const o of openings) {
    openingCounts[o] = (openingCounts[o] || 0) + 1;
  }

  const repeated: Record<string, number> = {};
  for (const [k, v] of Object.entries(openingCounts)) {
    if (v >= 3) repeated[k] = v;
  }

  const listItems = text.match(/(?:^|\n)\s*[-•*]\s*(.+)/g) || [];
  let listLenStd = 0;
  if (listItems.length >= 3) {
    const listLengths = listItems.map((item) => tokenizeWords(item).length);
    const avg = listLengths.reduce((a, b) => a + b, 0) / listLengths.length;
    listLenStd = Math.sqrt(
      listLengths.reduce((sum, l) => sum + (l - avg) ** 2, 0) / listLengths.length
    );
  }

  const examples: string[] = Object.entries(repeated).map(
    ([opening, count]) => `Opening "${opening}..." repeated ${count} times`
  );

  const repeatedCount = Object.values(repeated).reduce((a, b) => a + b, 0);

  let score: number;
  if (repeatedCount === 0 && listLenStd > 5) {
    score = 1;
  } else if (repeatedCount <= 3) {
    score = 2;
  } else if (repeatedCount <= 6) {
    score = 3;
  } else if (repeatedCount <= 9) {
    score = 4;
  } else {
    score = 5;
  }

  const detail = `Repeated openings: ${Object.keys(repeated).length} patterns | List item length StdDev: ${listLenStd.toFixed(1)}`;

  return { signalId: 4, name: 'Pattern Repetition Audit', score, detail, examples };
}
