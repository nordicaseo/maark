import { SignalResult } from '../types';
import { AI_SIGNATURE_WORDS } from '../word-lists';

export function signal01LexicalDiversity(
  text: string,
  sentences: string[],
  words: string[],
  paragraphs: string[]
): Omit<SignalResult, 'weight'> {
  if (words.length < 20) {
    return {
      signalId: 1,
      name: 'Lexical Diversity Index',
      score: 3,
      detail: 'Text too short for reliable lexical analysis.',
      examples: [],
    };
  }

  const window = 100;
  const ttrs: number[] = [];
  for (let i = 0; i < Math.max(1, words.length - window + 1); i += 50) {
    const chunk = words.slice(i, i + window);
    if (chunk.length >= 50) {
      ttrs.push(new Set(chunk).size / chunk.length);
    }
  }

  const avgTtr =
    ttrs.length > 0
      ? ttrs.reduce((a, b) => a + b, 0) / ttrs.length
      : new Set(words).size / words.length;

  const textLower = text.toLowerCase();
  const foundSig: string[] = [];
  for (const w of Array.from(AI_SIGNATURE_WORDS)) {
    if (textLower.includes(w)) {
      foundSig.push(w);
    }
  }

  const examples: string[] = foundSig
    .slice(0, 5)
    .map((w) => `AI signature word: "${w}"`);

  let score: number;
  if (avgTtr > 0.72 && foundSig.length === 0) {
    score = 1;
  } else if (avgTtr > 0.65 && foundSig.length <= 1) {
    score = 2;
  } else if (avgTtr > 0.58 || foundSig.length <= 2) {
    score = 3;
  } else if (avgTtr > 0.5 || foundSig.length <= 3) {
    score = 4;
  } else {
    score = 5;
  }

  const detail = `Avg TTR: ${avgTtr.toFixed(3)} | AI signature words found: ${foundSig.length}`;

  return { signalId: 1, name: 'Lexical Diversity Index', score, detail, examples };
}
