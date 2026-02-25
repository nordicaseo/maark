'use client';

import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ScoreGauge } from './score-gauge';
import { Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import type { ContentQualityResult } from '@/types/analysis';

interface QualityPanelProps {
  result: ContentQualityResult | null;
  analyzing: boolean;
}

function SubScore({ label, score, detail }: { label: string; score: number; detail: string }) {
  const color =
    score >= 70
      ? 'text-green-500'
      : score >= 40
        ? 'text-yellow-500'
        : 'text-red-500';

  return (
    <div className="border border-border rounded-lg p-3">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-medium">{label}</span>
        <span className={`text-sm font-bold tabular-nums ${color}`}>{score}</span>
      </div>
      <Progress value={score} className="h-1.5 mb-1.5" />
      <p className="text-[11px] text-muted-foreground">{detail}</p>
    </div>
  );
}

export function QualityPanel({ result, analyzing }: QualityPanelProps) {
  if (analyzing) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin mb-3" />
        <p className="text-sm">Checking content quality...</p>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p className="text-sm">Click "Analyze" to check content quality</p>
        <p className="text-xs mt-1">Measures readability, structure, and completeness</p>
      </div>
    );
  }

  const allSuggestions = [
    ...result.structure.suggestions,
    ...result.completeness.suggestions,
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-center py-2">
        <ScoreGauge
          value={result.score}
          max={100}
          label="Content Quality"
          size="lg"
        />
      </div>

      <div className="space-y-2">
        <SubScore
          label="Readability"
          score={result.readability.score}
          detail={`Grade level: ${result.readability.gradeLevel.toFixed(1)} | Avg sentence: ${result.readability.avgSentenceLength.toFixed(0)} words`}
        />
        <SubScore
          label="Structure"
          score={result.structure.score}
          detail={`${result.structure.headingCount} headings | ${result.structure.paragraphCount} paragraphs | ${result.structure.hasH1 ? 'Has' : 'Missing'} H1`}
        />
        <SubScore
          label="Completeness"
          score={result.completeness.score}
          detail={`${result.completeness.wordCount} / ${result.completeness.targetMin}-${result.completeness.targetMax} target words`}
        />
      </div>

      {allSuggestions.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Suggestions
          </h4>
          <div className="space-y-1.5">
            {allSuggestions.map((s, i) => (
              <div
                key={i}
                className="flex items-start gap-2 text-xs text-muted-foreground border border-border rounded-md p-2"
              >
                <AlertCircle className="h-3.5 w-3.5 text-yellow-500 shrink-0 mt-0.5" />
                {s}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
