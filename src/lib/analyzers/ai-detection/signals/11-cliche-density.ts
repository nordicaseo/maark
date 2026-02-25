import { SignalResult } from '../types';
import { tokenizeWords } from '../utils';
import { AI_CLICHES, AI_SIGNATURE_WORDS } from '../word-lists';

export function signal11ClicheDensity(
  text: string,
  sentences: string[],
  words: string[],
  paragraphs: string[]
): Omit<SignalResult, 'weight'> {
  const textLower = text.toLowerCase();
  const found: string[] = [];

  for (const cliche of AI_CLICHES) {
    let idx = textLower.indexOf(cliche);
    while (idx !== -1) {
      found.push(cliche);
      idx = textLower.indexOf(cliche, idx + 1);
    }
  }

  for (const word of Array.from(AI_SIGNATURE_WORDS)) {
    if (textLower.includes(word)) {
      found.push(word);
    }
  }

  const uniqueFound = Array.from(new Set(found));
  const examples = uniqueFound.slice(0, 5).map((c) => `Cliché: "${c}"`);

  const total = found.length;
  const wordCount = tokenizeWords(text).length;
  const density = (total / Math.max(1, wordCount)) * 100;

  let score: number;
  if (total === 0) {
    score = 1;
  } else if (total <= 1) {
    score = 2;
  } else if (total <= 3) {
    score = 3;
  } else if (total <= 5) {
    score = 4;
  } else {
    score = 5;
  }

  const detail = `Clichés found: ${total} | Density: ${density.toFixed(2)} per 100 words`;

  return { signalId: 11, name: 'Cliche Density', score, detail, examples };
}
