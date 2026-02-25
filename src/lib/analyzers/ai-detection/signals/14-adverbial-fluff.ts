import { SignalResult } from '../types';
import { FLUFF_ADVERBS } from '../word-lists';

export function signal14AdverbialFluff(
  text: string,
  sentences: string[],
  words: string[],
  paragraphs: string[]
): Omit<SignalResult, 'weight'> {
  const textLower = text.toLowerCase();
  const found: string[] = [];

  for (const adv of FLUFF_ADVERBS) {
    const pattern = new RegExp('\\b' + adv + '\\b', 'g');
    const matches = textLower.match(pattern);
    if (matches) {
      for (let i = 0; i < matches.length; i++) {
        found.push(adv);
      }
    }
  }

  const total = found.length;
  const density = (total / Math.max(1, words.length)) * 100;

  const uniqueFound = Array.from(new Set(found));
  const examples = uniqueFound.slice(0, 5).map((a) => `Fluff adverb: "${a}"`);

  let score: number;
  if (total === 0) {
    score = 1;
  } else if (total <= 2) {
    score = 2;
  } else if (total <= 4) {
    score = 3;
  } else if (total <= 7) {
    score = 4;
  } else {
    score = 5;
  }

  const detail = `Fluff adverbs: ${total} | Density: ${density.toFixed(2)} per 100 words`;

  return { signalId: 14, name: 'Adverbial Fluff Score', score, detail, examples };
}