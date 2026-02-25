import { SignalResult } from '../types';

const PASSIVE_PATTERN = /\b(is|are|was|were|be|been|being)\s+(\w+ed|\w+en|\w+t)\b/i;

export function signal06PassiveVoice(
  text: string,
  sentences: string[],
  words: string[],
  paragraphs: string[]
): Omit<SignalResult, 'weight'> {
  let passiveCount = 0;
  for (const s of sentences) {
    if (PASSIVE_PATTERN.test(s)) {
      passiveCount++;
    }
  }

  const ratio = (passiveCount / Math.max(1, sentences.length)) * 100;

  const examples: string[] = [];
  for (const s of sentences.slice(0, 20)) {
    const m = s.match(PASSIVE_PATTERN);
    if (m && examples.length < 3) {
      examples.push(`Passive: "...${m[0]}..."`);
    }
  }

  let score: number;
  if (ratio < 10) {
    score = 1;
  } else if (ratio < 15) {
    score = 2;
  } else if (ratio < 25) {
    score = 3;
  } else if (ratio < 35) {
    score = 4;
  } else {
    score = 5;
  }

  const detail = `Passive ratio: ${ratio.toFixed(0)}% (${passiveCount}/${sentences.length} sentences)`;

  return { signalId: 6, name: 'Passive Voice Saturation', score, detail, examples };
}
