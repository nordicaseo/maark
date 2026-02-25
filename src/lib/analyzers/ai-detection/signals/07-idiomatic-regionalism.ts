import { SignalResult } from '../types';
import { tokenizeSentences } from '../utils';

export function signal07IdiomaticRegionalism(
  text: string,
  sentences: string[],
  words: string[],
  paragraphs: string[]
): Omit<SignalResult, 'weight'> {
  const contractions = (text.toLowerCase().match(/\b\w+'(t|re|ve|ll|d|s|m)\b/g) || []).length;
  const colloquialMarkers = (
    text
      .toLowerCase()
      .match(
        /\b(gonna|wanna|gotta|kinda|sorta|yeah|nah|okay|ok|hey|look|honestly|frankly|literally|stuff|things|deal|pretty much|big deal|no way|for real)\b/g
      ) || []
  ).length;

  const totalSents = tokenizeSentences(text).length;
  const contractionDensity = contractions / Math.max(1, totalSents);

  const examples: string[] = [];
  if (contractions === 0 && words.length > 100) {
    examples.push('Zero contractions in 100+ word text');
  }

  let score: number;
  if (contractionDensity > 0.5 && colloquialMarkers >= 2) {
    score = 1;
  } else if (contractionDensity > 0.3 || colloquialMarkers >= 1) {
    score = 2;
  } else if (contractionDensity > 0.15) {
    score = 3;
  } else if (contractions > 0) {
    score = 4;
  } else {
    score = 5;
  }

  const detail = `Contractions: ${contractions} | Colloquial markers: ${colloquialMarkers}`;

  return { signalId: 7, name: 'Idiomatic Regionalism', score, detail, examples };
}
