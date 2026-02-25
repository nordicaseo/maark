import { SignalResult } from '../types';
import { tokenizeSentences } from '../utils';

export function signal18NuancePreservation(
  text: string,
  sentences: string[],
  words: string[],
  paragraphs: string[]
): Omit<SignalResult, 'weight'> {
  const textLower = text.toLowerCase();

  const falseBalance = (
    textLower.match(
      /(on (the )?one hand|on the other hand|there are (both )?pros and cons|advantages and disadvantages|benefits and drawbacks)/g
    ) || []
  ).length;

  const strongPositions = (
    textLower.match(
      /\b(i (believe|think|argue|contend)|clearly wrong|clearly right|without (a )?doubt|the best approach|the worst|undeniably)\b/g
    ) || []
  ).length;

  const specificCaveats = (
    textLower.match(
      /\b(except when|unless|but only if|this (doesn't|won't) work (if|when)|the exception is|it depends on)\b/g
    ) || []
  ).length;

  const examples: string[] = [];
  if (falseBalance >= 2) {
    examples.push(`${falseBalance} false-balance patterns`);
  }
  if (strongPositions === 0 && tokenizeSentences(text).length > 5) {
    examples.push('No strong positions taken');
  }

  let score: number;
  if (specificCaveats >= 2 && strongPositions >= 1) {
    score = 1;
  } else if (specificCaveats >= 1 || strongPositions >= 1) {
    score = 2;
  } else if (falseBalance <= 1) {
    score = 3;
  } else if (falseBalance <= 2) {
    score = 4;
  } else {
    score = 5;
  }

  const detail = `False balance: ${falseBalance} | Strong positions: ${strongPositions} | Specific caveats: ${specificCaveats}`;

  return { signalId: 18, name: 'Nuance Preservation', score, detail, examples };
}