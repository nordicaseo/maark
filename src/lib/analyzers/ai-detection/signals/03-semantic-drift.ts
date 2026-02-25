import { SignalResult } from '../types';
import { tokenizeWords } from '../utils';

const STOPWORDS = new Set([
  'the','a','an','is','are','was','were','be','been','being','have','has','had',
  'do','does','did','will','would','could','should','may','might','shall','can',
  'to','of','in','for','on','with','at','by','from','as','into','through',
  'during','before','after','above','below','between','out','off','over','under',
  'again','further','then','once','here','there','when','where','why','how','all',
  'each','every','both','few','more','most','other','some','such','no','nor','not',
  'only','own','same','so','than','too','very','just','because','but','and','or',
  'if','while','that','this','it','its','i','me','my','we','our','you','your',
  'he','she','they','them','their','what','which','who','whom',
]);

export function signal03SemanticDrift(
  text: string,
  sentences: string[],
  words: string[],
  paragraphs: string[]
): Omit<SignalResult, 'weight'> {
  if (paragraphs.length < 2) {
    return {
      signalId: 3,
      name: 'Semantic Drift Monitor',
      score: 3,
      detail: 'Too few paragraphs for drift analysis.',
      examples: [],
    };
  }

  const paraKeywords: Set<string>[] = paragraphs.map((p) => {
    const w = new Set(tokenizeWords(p));
    Array.from(STOPWORDS).forEach((sw) => w.delete(sw));
    return w;
  });

  const overlaps: number[] = [];
  for (let i = 0; i < paraKeywords.length - 1; i++) {
    if (paraKeywords[i].size > 0 && paraKeywords[i + 1].size > 0) {
      const intersection = new Set(Array.from(paraKeywords[i]).filter((x) => paraKeywords[i + 1].has(x)));
      const union = new Set(Array.from(paraKeywords[i]).concat(Array.from(paraKeywords[i + 1])));
      overlaps.push(intersection.size / Math.max(1, union.size));
    }
  }

  const avgOverlap =
    overlaps.length > 0
      ? overlaps.reduce((a, b) => a + b, 0) / overlaps.length
      : 0.5;

  const tangentMarkers = (
    text.toLowerCase().match(
      /speaking of|reminds me|by the way|on a side note|funny enough|incidentally|tangent/g
    ) || []
  ).length;

  const examples: string[] = [];
  if (avgOverlap > 0.3) {
    examples.push(`High keyword overlap between paragraphs (${avgOverlap.toFixed(2)})`);
  }

  let score: number;
  if (avgOverlap < 0.15 || tangentMarkers >= 2) {
    score = 1;
  } else if (avgOverlap < 0.22 || tangentMarkers >= 1) {
    score = 2;
  } else if (avgOverlap < 0.3) {
    score = 3;
  } else if (avgOverlap < 0.4) {
    score = 4;
  } else {
    score = 5;
  }

  const detail = `Avg keyword overlap: ${avgOverlap.toFixed(3)} | Tangent markers: ${tangentMarkers}`;

  return { signalId: 3, name: 'Semantic Drift Monitor', score, detail, examples };
}
