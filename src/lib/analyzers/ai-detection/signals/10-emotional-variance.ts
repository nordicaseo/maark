import { SignalResult } from '../types';

export function signal10EmotionalVariance(
  text: string,
  sentences: string[],
  words: string[],
  paragraphs: string[]
): Omit<SignalResult, 'weight'> {
  const exclamations = (text.match(/!/g) || []).length;
  const questions = (text.match(/\?/g) || []).length;
  const positiveWords = (
    text
      .toLowerCase()
      .match(
        /\b(love|great|amazing|excellent|fantastic|wonderful|brilliant|excited|thrilled)\b/g
      ) || []
  ).length;
  const negativeWords = (
    text
      .toLowerCase()
      .match(
        /\b(hate|terrible|awful|horrible|frustrating|annoying|painful|disappointing|angry|furious)\b/g
      ) || []
  ).length;
  const hedgeWords = (
    text
      .toLowerCase()
      .match(
        /\b(maybe|perhaps|probably|might|could be|not sure|i think|i guess|i feel)\b/g
      ) || []
  ).length;
  const humorMarkers = (
    text
      .toLowerCase()
      .match(/\b(haha|lol|funny|hilarious|joking|kidding|ironic)\b/g) || []
  ).length;

  const totalEmotional =
    exclamations + questions + positiveWords + negativeWords + hedgeWords + humorMarkers;

  const hasRange =
    (positiveWords > 0 && negativeWords > 0) ||
    (hedgeWords > 0 && (positiveWords > 0 || negativeWords > 0));

  const examples: string[] = [];
  if (totalEmotional === 0) {
    examples.push('Zero emotional markers in entire text');
  }
  if (!hasRange && sentences.length > 5) {
    examples.push('No emotional range — flat affect throughout');
  }

  let score: number;
  if (hasRange && totalEmotional >= 5) {
    score = 1;
  } else if (totalEmotional >= 3 || hasRange) {
    score = 2;
  } else if (totalEmotional >= 1) {
    score = 3;
  } else if (sentences.length > 3) {
    score = 4;
  } else {
    score = 5;
  }

  const detail = `Emotional markers: ${totalEmotional} | Range: ${hasRange ? 'yes' : 'no'} | Exclamations: ${exclamations}`;

  return { signalId: 10, name: 'Emotional Variance', score, detail, examples };
}
