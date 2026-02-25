export const SIGNAL_WEIGHTS: Record<number, number> = {
  1: 2,
  2: 3,
  3: 1,
  4: 2,
  5: 2,
  6: 1,
  7: 1,
  8: 3,
  9: 2,
  10: 2,
  11: 3,
  12: 1,
  13: 1,
  14: 3,
  15: 1,
  16: 1,
  17: 2,
  18: 1,
  19: 1,
  20: 3,
  21: 2,
};

export const SIGNAL_NAMES: Record<number, string> = {
  1: 'Lexical Diversity Index',
  2: 'Syntactic Burstiness',
  3: 'Semantic Drift Monitor',
  4: 'Pattern Repetition Audit',
  5: 'Pronominal Frequency',
  6: 'Passive Voice Saturation',
  7: 'Idiomatic Regionalism',
  8: 'Transition Word Predictability',
  9: 'Sentence Complexity Jitter',
  10: 'Emotional Variance',
  11: 'Cliche Density',
  12: 'Rhetorical Question Ratio',
  13: 'Verb Tense Consistency',
  14: 'Adverbial Fluff Score',
  15: 'Proper Noun Density',
  16: 'Formatting Logic Consistency',
  17: 'Metaphor Originality',
  18: 'Nuance Preservation',
  19: 'Prompt Leakage Detection',
  20: 'Perplexity Score Volatility',
  21: 'Colon Lead-In Density',
};

export function getRiskLevel(compositeScore: number): 'Low' | 'Moderate' | 'High' {
  if (compositeScore <= 2.0) return 'Low';
  if (compositeScore <= 3.2) return 'Moderate';
  return 'High';
}
