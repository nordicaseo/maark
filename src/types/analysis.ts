export interface SignalResult {
  signalId: number;
  name: string;
  score: number;
  weight: number;
  detail: string;
  examples: string[];
}

export interface AiDetectionResult {
  compositeScore: number;
  riskLevel: 'Low' | 'Moderate' | 'High';
  signals: SignalResult[];
  wordCount: number;
  sentenceCount: number;
  paragraphCount: number;
}

export interface ContentQualityResult {
  score: number;
  readability: {
    score: number;
    gradeLevel: number;
    avgSentenceLength: number;
    avgSyllablesPerWord: number;
  };
  structure: {
    score: number;
    headingCount: number;
    paragraphCount: number;
    hasH1: boolean;
    avgParagraphLength: number;
    suggestions: string[];
  };
  completeness: {
    score: number;
    wordCount: number;
    targetMin: number;
    targetMax: number;
    suggestions: string[];
  };
}

export interface SemanticResult {
  score: number;
  entitiesCovered: string[];
  entitiesMissing: string[];
  lsiCovered: string[];
  lsiMissing: string[];
}
