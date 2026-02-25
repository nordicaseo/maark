import { SignalResult } from '../types';
import { AI_TRANSITION_PHRASES } from '../word-lists';

export function signal08TransitionPredictability(
  text: string,
  sentences: string[],
  words: string[],
  paragraphs: string[]
): Omit<SignalResult, 'weight'> {
  const textLower = text.toLowerCase();
  const found: string[] = [];

  for (const phrase of AI_TRANSITION_PHRASES) {
    let idx = textLower.indexOf(phrase);
    while (idx !== -1) {
      found.push(phrase);
      idx = textLower.indexOf(phrase, idx + 1);
    }
  }

  const uniqueFound = Array.from(new Set(found));
  const examples = uniqueFound.slice(0, 5).map((p) => `AI transition: "${p}"`);

  const total = found.length;

  let score: number;
  if (total === 0) {
    score = 1;
  } else if (total === 1) {
    score = 2;
  } else if (total === 2) {
    score = 3;
  } else if (total <= 4) {
    score = 4;
  } else {
    score = 5;
  }

  const detail = `AI-signature transitions found: ${total}`;

  return {
    signalId: 8,
    name: 'Transition Word Predictability',
    score,
    detail,
    examples,
  };
}
