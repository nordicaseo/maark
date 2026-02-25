import { SignalResult } from '../types';
import { DEAD_METAPHORS } from '../word-lists';

export function signal17MetaphorOriginality(
  text: string,
  sentences: string[],
  words: string[],
  paragraphs: string[]
): Omit<SignalResult, 'weight'> {
  const textLower = text.toLowerCase();
  const foundDead = DEAD_METAPHORS.filter((m) => textLower.includes(m));
  const simileCount = (textLower.match(/\blike a\b|\bas if\b|\bas though\b/g) || []).length;

  const examples = foundDead.slice(0, 5).map((m) => `Dead metaphor: "${m}"`);

  let score: number;
  if (foundDead.length === 0 && simileCount >= 1) {
    score = 1;
  } else if (foundDead.length === 0) {
    score = 2;
  } else if (foundDead.length === 1) {
    score = 3;
  } else if (foundDead.length <= 3) {
    score = 4;
  } else {
    score = 5;
  }

  const detail = `Dead metaphors: ${foundDead.length} | Similes/figurative: ${simileCount}`;

  return { signalId: 17, name: 'Metaphor Originality', score, detail, examples };
}