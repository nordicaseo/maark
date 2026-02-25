import { SignalResult } from '../types';

const FIRST_PERSON = new Set(['i', 'me', 'my', 'mine', 'myself', 'we', 'us', 'our', 'ours']);

export function signal05PronominalFrequency(
  text: string,
  sentences: string[],
  words: string[],
  paragraphs: string[]
): Omit<SignalResult, 'weight'> {
  const firstPerson = words.filter((w) => FIRST_PERSON.has(w)).length;
  const impersonal = (
    text
      .toLowerCase()
      .match(/\b(it is|there are|there is|one might|one can|one should|it has been)\b/g) || []
  ).length;

  const total = words.length;
  const fpRatio = (firstPerson / Math.max(1, total)) * 100;
  const impRatio = (impersonal / Math.max(1, total)) * 100;

  const examples: string[] = [];
  if (fpRatio < 0.5 && total > 100) {
    examples.push('No first-person pronouns in 100+ word text');
  }
  if (impersonal > 3) {
    examples.push(
      `${impersonal} impersonal constructions ("it is", "there are")`
    );
  }

  let score: number;
  if (fpRatio > 2 && impersonal <= 1) {
    score = 1;
  } else if (fpRatio > 1 || impersonal <= 2) {
    score = 2;
  } else if (fpRatio > 0.5) {
    score = 3;
  } else if (fpRatio > 0 || impersonal <= 4) {
    score = 4;
  } else {
    score = 5;
  }

  const detail = `First-person: ${fpRatio.toFixed(1)}% | Impersonal constructions: ${impersonal}`;

  return { signalId: 5, name: 'Pronominal Frequency', score, detail, examples };
}
