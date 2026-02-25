import { SignalResult } from '../types';

export function signal12RhetoricalQuestions(
  text: string,
  sentences: string[],
  words: string[],
  paragraphs: string[]
): Omit<SignalResult, 'weight'> {
  const questions = sentences.filter((s) => s.trim().endsWith('?'));
  const totalQ = questions.length;

  const formulaic = questions.filter((q) =>
    /(but (what|how) does this|but is this really|what does this mean|why does this matter)/i.test(q)
  );

  const examples: string[] = formulaic
    .slice(0, 3)
    .map((q) => `Formulaic question: "${q.slice(0, 60)}..."`);

  let score: number;
  if (totalQ >= 1 && totalQ <= 3 && formulaic.length === 0) {
    score = 1;
  } else if (totalQ >= 1 && formulaic.length === 0) {
    score = 2;
  } else if (totalQ === 0 && sentences.length < 10) {
    score = 3;
  } else if (totalQ === 0) {
    score = 4;
  } else {
    score = formulaic.length > 0 ? 4 : 3;
  }

  const detail = `Rhetorical questions: ${totalQ} | Formulaic: ${formulaic.length}`;

  return { signalId: 12, name: 'Rhetorical Question Ratio', score, detail, examples };
}