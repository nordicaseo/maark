import { SignalResult } from '../types';
import { getParagraphs, tokenizeWords } from '../utils';

export function signal16FormattingConsistency(
  text: string,
  sentences: string[],
  words: string[],
  paragraphs: string[]
): Omit<SignalResult, 'weight'> {
  const headers = text.match(/^#{1,6}\s+.+/gm) || [];
  const bulletLists = text.match(/(?:^|\n)\s*[-•*]\s+/g) || [];
  const numberedLists = text.match(/(?:^|\n)\s*\d+[.)]\s+/g) || [];

  const paras = getParagraphs(text);
  const paraLengths = paras
    .filter((p) => !p.startsWith('#'))
    .map((p) => tokenizeWords(p).length);

  let paraStd = 0;
  if (paraLengths.length >= 3) {
    const avg = paraLengths.reduce((a, b) => a + b, 0) / paraLengths.length;
    paraStd = Math.sqrt(
      paraLengths.reduce((sum, l) => sum + (l - avg) ** 2, 0) / paraLengths.length
    );
  }

  const isHighlyStructured =
    headers.length >= 3 && (bulletLists.length >= 3 || numberedLists.length >= 3);

  const examples: string[] = [];
  if (isHighlyStructured) {
    examples.push(
      `Highly structured: ${headers.length} headers, ${bulletLists.length} bullets`
    );
  }
  if (paraStd < 15 && paraLengths.length >= 3) {
    examples.push(`Paragraph lengths very uniform (StdDev: ${paraStd.toFixed(0)})`);
  }

  let score: number;
  if (paraStd > 40 && !isHighlyStructured) {
    score = 1;
  } else if (paraStd > 25 || !isHighlyStructured) {
    score = 2;
  } else if (paraStd > 15) {
    score = 3;
  } else if (isHighlyStructured) {
    score = 4;
  } else {
    score = 5;
  }

  const detail = `Headers: ${headers.length} | Bullets: ${bulletLists.length} | Para length StdDev: ${paraStd.toFixed(0)}`;

  return { signalId: 16, name: 'Formatting Logic Consistency', score, detail, examples };
}