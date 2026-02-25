import { SignalResult } from '../types';
import { tokenizeWords } from '../utils';

export function signal02SyntacticBurstiness(
  text: string,
  sentences: string[],
  words: string[],
  paragraphs: string[]
): Omit<SignalResult, 'weight'> {
  if (sentences.length < 3) {
    return {
      signalId: 2,
      name: 'Syntactic Burstiness',
      score: 3,
      detail: 'Too few sentences for burstiness analysis.',
      examples: [],
    };
  }

  const lengths = sentences.map((s) => tokenizeWords(s).length);
  const avgLen = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const stdDev = Math.sqrt(
    lengths.reduce((sum, l) => sum + (l - avgLen) ** 2, 0) / lengths.length
  );
  const minLen = Math.min(...lengths);
  const maxLen = Math.max(...lengths);

  const examples: string[] = [];
  if (stdDev < 7) {
    examples.push(
      `Sentence lengths cluster narrowly: ${JSON.stringify(lengths.slice().sort((a, b) => a - b).slice(0, 10))}...`
    );
  }

  let score: number;
  if (stdDev > 12) {
    score = 1;
  } else if (stdDev > 9) {
    score = 2;
  } else if (stdDev > 7) {
    score = 3;
  } else if (stdDev > 5) {
    score = 4;
  } else {
    score = 5;
  }

  const detail = `StdDev: ${stdDev.toFixed(1)} | Range: ${minLen}–${maxLen} words | Avg: ${avgLen.toFixed(1)}`;

  return { signalId: 2, name: 'Syntactic Burstiness', score, detail, examples };
}
