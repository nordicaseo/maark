import type { SemanticResult } from '@/types/analysis';

export function analyzeSemanticCoverage(
  userText: string,
  entities: { term: string }[],
  lsiKeywords: { term: string }[]
): SemanticResult {
  const textLower = userText.toLowerCase();
  const userWords = new Set(
    textLower.match(/[a-z]+/g) || []
  );

  const entitiesCovered = entities
    .filter((e) => textLower.includes(e.term.toLowerCase()))
    .map((e) => e.term);

  const entitiesMissing = entities
    .filter((e) => !textLower.includes(e.term.toLowerCase()))
    .map((e) => e.term);

  const lsiCovered = lsiKeywords
    .filter((k) => userWords.has(k.term.toLowerCase()) || textLower.includes(k.term.toLowerCase()))
    .map((k) => k.term);

  const lsiMissing = lsiKeywords
    .filter((k) => !userWords.has(k.term.toLowerCase()) && !textLower.includes(k.term.toLowerCase()))
    .map((k) => k.term);

  const entityCoverage =
    entities.length > 0 ? entitiesCovered.length / entities.length : 1;
  const lsiCoverage =
    lsiKeywords.length > 0 ? lsiCovered.length / lsiKeywords.length : 1;

  const score = Math.round((entityCoverage * 0.6 + lsiCoverage * 0.4) * 100);

  return {
    score,
    entitiesCovered,
    entitiesMissing,
    lsiCovered,
    lsiMissing,
  };
}
