import { SignalResult } from '../types';
import { tokenizeWords } from '../utils';

export function signal09ComplexityJitter(
  text: string,
  sentences: string[],
  words: string[],
  paragraphs: string[]
): Omit<SignalResult, 'weight'> {
  if (sentences.length < 3) {
    return {
      signalId: 9,
      name: 'Sentence Complexity Jitter',
      score: 3,
      detail: 'Too few sentences.',
      examples: [],
    };
  }

  const complexities: number[] = sentences.map((s) => {
    const clauses = (s.match(/[,;]|\band\b|\bbut\b|\bor\b|\bwhile\b|\balthough\b|\bbecause\b/g) || []).length;
    return clauses + 1;
  });

  const avg = complexities.reduce((a, b) => a + b, 0) / complexities.length;
  const std = Math.sqrt(
    complexities.reduce((sum, c) => sum + (c - avg) ** 2, 0) / complexities.length
  );

  const hasSimple = complexities.some(
    (c, i) => c === 1 && tokenizeWords(sentences[i]).length < 6
  );
  const hasComplex = complexities.some((c) => c >= 4);

  const examples: string[] = [];
  if (!hasSimple) {
    examples.push('No very simple sentences (< 6 words, single clause)');
  }
  if (!hasComplex) {
    examples.push('No complex multi-clause sentences');
  }

  let score: number;
  if (std > 1.5 && hasSimple && hasComplex) {
    score = 1;
  } else if (std > 1.2 || (hasSimple && hasComplex)) {
    score = 2;
  } else if (std > 0.9) {
    score = 3;
  } else if (std > 0.6) {
    score = 4;
  } else {
    score = 5;
  }

  const detail = `Complexity StdDev: ${std.toFixed(2)} | Simple sentences: ${hasSimple} | Complex: ${hasComplex}`;

  return { signalId: 9, name: 'Sentence Complexity Jitter', score, detail, examples };
}
