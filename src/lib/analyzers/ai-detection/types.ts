export interface SignalResult {
  signalId: number;
  name: string;
  score: number;
  weight: number;
  detail: string;
  examples: string[];
}

export interface AnalysisResult {
  compositeScore: number;
  riskLevel: 'Low' | 'Moderate' | 'High';
  signals: SignalResult[];
  wordCount: number;
  sentenceCount: number;
  paragraphCount: number;
}

export type SignalFunction = (text: string, sentences: string[], words: string[], paragraphs: string[]) => Omit<SignalResult, 'weight'>;
