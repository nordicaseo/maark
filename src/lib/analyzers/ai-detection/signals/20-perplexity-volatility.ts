import { SignalResult } from '../types';
import { COMMON_WORDS } from '../word-lists';

export function signal20PerplexityVolatility(
  text: string,
  sentences: string[],
  words: string[],
  paragraphs: string[]
): Omit<SignalResult, 'weight'> {
  const uncommon = words.filter((w) => !COMMON_WORDS.has(w) && w.length > 3);
  const uncommonRatio = uncommon.length / Math.max(1, words.length);

  const examples: string[] = [];
  if (uncommonRatio < 0.1) {
    examples.push('Very few uncommon words \u2014 text is highly predictable');
  }

  let score: number;
  if (uncommonRatio > 0.35) {
    score = 1;
  } else if (uncommonRatio > 0.25) {
    score = 2;
  } else if (uncommonRatio > 0.18) {
    score = 3;
  } else if (uncommonRatio > 0.12) {
    score = 4;
  } else {
    score = 5;
  }

  const detail = `Uncommon word ratio: ${(uncommonRatio * 100).toFixed(2)}%`;

  return { signalId: 20, name: 'Perplexity Score Volatility', score, detail, examples };
}