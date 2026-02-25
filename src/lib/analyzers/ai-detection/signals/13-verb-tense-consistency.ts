import { SignalResult } from '../types';

const PAST_PATTERN = /\b(was|were|had|did|\w+ed)\b/g;
const PRESENT_PATTERN = /\b(is|are|has|does|do)\b/g;

export function signal13VerbTenseConsistency(
  text: string,
  sentences: string[],
  words: string[],
  paragraphs: string[]
): Omit<SignalResult, 'weight'> {
  const tenses: string[] = [];

  for (const s of sentences) {
    const past = (s.match(PAST_PATTERN) || []).length;
    const present = (s.match(PRESENT_PATTERN) || []).length;
    if (past > present) {
      tenses.push('past');
    } else if (present > past) {
      tenses.push('present');
    } else {
      tenses.push('mixed');
    }
  }

  if (tenses.length === 0) {
    return {
      signalId: 13,
      name: 'Verb Tense Consistency',
      score: 3,
      detail: 'Could not determine tenses.',
      examples: [],
    };
  }

  const tenseCounts: Record<string, number> = {};
  for (const t of tenses) {
    tenseCounts[t] = (tenseCounts[t] || 0) + 1;
  }

  const dominantRatio = Math.max(...Object.values(tenseCounts)) / tenses.length;
  const hasShift = new Set(tenses).size > 1;

  const examples: string[] = [];
  if (dominantRatio > 0.9) {
    examples.push(
      `Rigid tense: ${Math.round(dominantRatio * 100)}% sentences in same tense`
    );
  }

  let score: number;
  if (dominantRatio < 0.65 && hasShift) {
    score = 1;
  } else if (dominantRatio < 0.75) {
    score = 2;
  } else if (dominantRatio < 0.85) {
    score = 3;
  } else if (dominantRatio < 0.95) {
    score = 4;
  } else {
    score = 5;
  }

  const detail = `Dominant tense ratio: ${Math.round(dominantRatio * 100)}% | Distribution: ${JSON.stringify(tenseCounts)}`;

  return { signalId: 13, name: 'Verb Tense Consistency', score, detail, examples };
}