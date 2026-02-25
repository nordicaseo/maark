import { SignalResult } from '../types';
import { PROMPT_LEAKAGE_PATTERNS } from '../word-lists';

export function signal19PromptLeakage(
  text: string,
  sentences: string[],
  words: string[],
  paragraphs: string[]
): Omit<SignalResult, 'weight'> {
  const textLower = text.toLowerCase().trim();
  const found: RegExp[] = [];

  for (const pattern of PROMPT_LEAKAGE_PATTERNS) {
    if (pattern.test(textLower)) {
      found.push(pattern);
    }
  }

  const startsWithList = /^\s*1[.)]\s/.test(text.trim());

  const examples: string[] = [];
  if (found.length > 0) {
    examples.push(
      ...found.slice(0, 3).map((p) => `Prompt pattern detected: ${p.source}`)
    );
  }
  if (startsWithList) {
    examples.push('Text opens with a numbered list');
  }

  const total = found.length + (startsWithList ? 1 : 0);

  let score: number;
  if (total === 0) {
    score = 1;
  } else if (total === 1) {
    score = 3;
  } else if (total === 2) {
    score = 4;
  } else {
    score = 5;
  }

  const detail = `Leakage patterns: ${total}`;

  return { signalId: 19, name: 'Prompt Leakage Detection', score, detail, examples };
}