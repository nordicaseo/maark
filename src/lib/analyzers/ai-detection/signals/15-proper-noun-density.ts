import { SignalResult } from '../types';
import { tokenizeSentences } from '../utils';

const SKIP_WORDS = new Set(['i', 'the', 'a', 'an']);

export function signal15ProperNounDensity(
  text: string,
  sentences: string[],
  words: string[],
  paragraphs: string[]
): Omit<SignalResult, 'weight'> {
  const sents = tokenizeSentences(text);
  const properNouns = new Set<string>();

  for (const s of sents) {
    const sWords = s.split(/\\s+/);
    for (const w of sWords.slice(1)) {
      if (w && w[0] === w[0].toUpperCase() && w[0] !== w[0].toLowerCase() && !SKIP_WORDS.has(w.toLowerCase())) {
        properNouns.add(w);
      }
    }
  }

  const vagueRefs = (
    text
      .toLowerCase()
      .match(
        /\\b(many (people|experts|studies|researchers)|some (argue|believe|say)|experts say|studies show|research suggests|it has been (shown|found|noted))\\b/g
      ) || []
  ).length;

  const examples: string[] = [];
  if (vagueRefs > 0) {
    examples.push(
      `${vagueRefs} vague references ("experts say", "studies show")`
    );
  }
  if (properNouns.size === 0 && words.length > 100) {
    examples.push('No proper nouns in 100+ word text');
  }

  const pnDensity = (properNouns.size / Math.max(1, words.length)) * 100;

  let score: number;
  if (pnDensity > 2 && vagueRefs === 0) {
    score = 1;
  } else if (pnDensity > 1 || vagueRefs === 0) {
    score = 2;
  } else if (vagueRefs <= 1) {
    score = 3;
  } else if (vagueRefs <= 3) {
    score = 4;
  } else {
    score = 5;
  }

  const detail = `Proper nouns: ${properNouns.size} | Vague references: ${vagueRefs}`;

  return { signalId: 15, name: 'Proper Noun Density', score, detail, examples };
}