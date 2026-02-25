import { SignalResult } from '../types';
import { tokenizeWords } from '../utils';
import { COLON_LEADINS } from '../word-lists';

export function signal21ColonLeadIn(
  text: string,
  sentences: string[],
  words: string[],
  paragraphs: string[]
): Omit<SignalResult, 'weight'> {
  const textLower = text.toLowerCase();
  const found: RegExp[] = [];
  const foundTexts: string[] = [];

  for (const pattern of COLON_LEADINS) {
    const globalPattern = new RegExp(pattern.source, 'gi');
    let m: RegExpExecArray | null;
    while ((m = globalPattern.exec(textLower)) !== null) {
      const start = Math.max(0, m.index - 10);
      const end = Math.min(text.length, m.index + m[0].length + 30);
      const context = text.slice(start, end).trim();
      if (!foundTexts.includes(context)) {
        found.push(pattern);
        foundTexts.push(context);
      }
    }
  }

  const examples = foundTexts.slice(0, 5).map((t) => `Colon lead-in: "...${t}..."`);

  const total = foundTexts.length;
  const wordCount = tokenizeWords(text).length;
  const densityPer500 = (total / Math.max(1, wordCount)) * 500;

  let score: number;
  if (total === 0) {
    score = 1;
  } else if (total === 1 && wordCount > 300) {
    score = 2;
  } else if (total <= 2) {
    score = 3;
  } else if (total <= 4) {
    score = 4;
  } else {
    score = 5;
  }

  const detail = `Colon lead-ins found: ${total} | Density: ${densityPer500.toFixed(1)} per 500 words`;

  return { signalId: 21, name: 'Colon Lead-In Density', score, detail, examples };
}