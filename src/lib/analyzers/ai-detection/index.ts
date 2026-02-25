import { AnalysisResult, SignalFunction, SignalResult } from './types';
import { SIGNAL_WEIGHTS, SIGNAL_NAMES, getRiskLevel } from './weights';
import { tokenizeWords, tokenizeSentences, getParagraphs } from './utils';

import { signal01LexicalDiversity } from './signals/01-lexical-diversity';
import { signal02SyntacticBurstiness } from './signals/02-syntactic-burstiness';
import { signal03SemanticDrift } from './signals/03-semantic-drift';
import { signal04PatternRepetition } from './signals/04-pattern-repetition';
import { signal05PronominalFrequency } from './signals/05-pronominal-frequency';
import { signal06PassiveVoice } from './signals/06-passive-voice';
import { signal07IdiomaticRegionalism } from './signals/07-idiomatic-regionalism';
import { signal08TransitionPredictability } from './signals/08-transition-predictability';
import { signal09ComplexityJitter } from './signals/09-complexity-jitter';
import { signal10EmotionalVariance } from './signals/10-emotional-variance';
import { signal11ClicheDensity } from './signals/11-cliche-density';
import { signal12RhetoricalQuestions } from './signals/12-rhetorical-questions';
import { signal13VerbTenseConsistency } from './signals/13-verb-tense-consistency';
import { signal14AdverbialFluff } from './signals/14-adverbial-fluff';
import { signal15ProperNounDensity } from './signals/15-proper-noun-density';
import { signal16FormattingConsistency } from './signals/16-formatting-consistency';
import { signal17MetaphorOriginality } from './signals/17-metaphor-originality';
import { signal18NuancePreservation } from './signals/18-nuance-preservation';
import { signal19PromptLeakage } from './signals/19-prompt-leakage';
import { signal20PerplexityVolatility } from './signals/20-perplexity-volatility';
import { signal21ColonLeadIn } from './signals/21-colon-leadin';

const SIGNAL_FUNCTIONS: SignalFunction[] = [
  signal01LexicalDiversity,
  signal02SyntacticBurstiness,
  signal03SemanticDrift,
  signal04PatternRepetition,
  signal05PronominalFrequency,
  signal06PassiveVoice,
  signal07IdiomaticRegionalism,
  signal08TransitionPredictability,
  signal09ComplexityJitter,
  signal10EmotionalVariance,
  signal11ClicheDensity,
  signal12RhetoricalQuestions,
  signal13VerbTenseConsistency,
  signal14AdverbialFluff,
  signal15ProperNounDensity,
  signal16FormattingConsistency,
  signal17MetaphorOriginality,
  signal18NuancePreservation,
  signal19PromptLeakage,
  signal20PerplexityVolatility,
  signal21ColonLeadIn,
];

export function analyzeAiDetection(text: string): AnalysisResult {
  const words = tokenizeWords(text);
  const sentences = tokenizeSentences(text);
  const paragraphs = getParagraphs(text);

  const signals: SignalResult[] = [];
  let weightedSum = 0;
  let totalWeight = 0;

  for (const fn of SIGNAL_FUNCTIONS) {
    const result = fn(text, sentences, words, paragraphs);
    const weight = SIGNAL_WEIGHTS[result.signalId] ?? 1;
    const signalResult: SignalResult = {
      ...result,
      weight,
    };
    signals.push(signalResult);
    weightedSum += result.score * weight;
    totalWeight += weight;
  }

  const compositeScore = totalWeight > 0
    ? Math.round((weightedSum / totalWeight) * 100) / 100
    : 0;

  return {
    compositeScore,
    riskLevel: getRiskLevel(compositeScore),
    signals,
    wordCount: words.length,
    sentenceCount: sentences.length,
    paragraphCount: paragraphs.length,
  };
}

export type { AnalysisResult, SignalResult, SignalFunction } from './types';