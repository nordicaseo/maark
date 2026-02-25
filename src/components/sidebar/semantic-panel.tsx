'use client';

import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { ScoreGauge } from './score-gauge';
import { Check, X, Loader2, Search } from 'lucide-react';
import type { SemanticResult } from '@/types/analysis';
import type { SerpData } from '@/types/serp';

interface SemanticPanelProps {
  result: SemanticResult | null;
  serpData: SerpData | null;
  keyword: string | null;
  analyzing: boolean;
}

function TermList({
  title,
  covered,
  missing,
}: {
  title: string;
  covered: string[];
  missing: string[];
}) {
  const total = covered.length + missing.length;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          {title}
        </h4>
        <span className="text-xs text-muted-foreground tabular-nums">
          {covered.length}/{total}
        </span>
      </div>
      <Progress value={total > 0 ? (covered.length / total) * 100 : 0} className="h-1.5 mb-3" />
      <div className="flex flex-wrap gap-1.5">
        {covered.map((term) => (
          <Badge
            key={term}
            variant="secondary"
            className="text-[11px] bg-green-500/15 text-green-400 border border-green-500/20"
          >
            <Check className="h-2.5 w-2.5 mr-0.5" />
            {term}
          </Badge>
        ))}
        {missing.map((term) => (
          <Badge
            key={term}
            variant="secondary"
            className="text-[11px] bg-zinc-800 text-zinc-500 border border-zinc-700"
          >
            <X className="h-2.5 w-2.5 mr-0.5" />
            {term}
          </Badge>
        ))}
      </div>
    </div>
  );
}

export function SemanticPanel({ result, serpData, keyword, analyzing }: SemanticPanelProps) {
  if (!keyword) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Search className="h-8 w-8 mx-auto mb-3 opacity-50" />
        <p className="text-sm">No target keyword set</p>
        <p className="text-xs mt-1">Set a keyword in document settings to enable SERP analysis</p>
      </div>
    );
  }

  if (analyzing) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin mb-3" />
        <p className="text-sm">Analyzing SERP data...</p>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p className="text-sm mb-1">Target: <span className="font-medium text-foreground">{keyword}</span></p>
        <p className="text-xs">Click "Analyze" to fetch SERP data and score semantic coverage</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-center py-2">
        <ScoreGauge
          value={result.score}
          max={100}
          label="Semantic Coverage"
          size="lg"
        />
      </div>

      <div className="text-center">
        <Badge variant="outline" className="text-xs">
          Keyword: {keyword}
        </Badge>
        {serpData && (
          <p className="text-[10px] text-muted-foreground mt-1">
            Based on top {serpData.topUrls.length} SERP results
          </p>
        )}
      </div>

      <TermList
        title="Entities"
        covered={result.entitiesCovered}
        missing={result.entitiesMissing}
      />

      <TermList
        title="LSI Keywords"
        covered={result.lsiCovered}
        missing={result.lsiMissing}
      />
    </div>
  );
}
