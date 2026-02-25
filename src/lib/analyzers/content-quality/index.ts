import type { ContentQualityResult } from '@/types/analysis';
import { analyzeReadability } from './readability';
import { analyzeStructure } from './structure';
import { analyzeCompleteness } from './completeness';

export function analyzeContentQuality(
  text: string,
  contentType: string
): ContentQualityResult {
  const readability = analyzeReadability(text);
  const structure = analyzeStructure(text);
  const completeness = analyzeCompleteness(text, contentType);

  const score = Math.round(
    readability.score * 0.3 + structure.score * 0.35 + completeness.score * 0.35
  );

  return { score, readability, structure, completeness };
}
