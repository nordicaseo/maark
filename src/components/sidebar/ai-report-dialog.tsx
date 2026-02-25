'use client';

import { useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { SignalRadarChart } from './signal-radar-chart';
import { AlertTriangle } from 'lucide-react';
import type { AiDetectionResult, SignalResult } from '@/types/analysis';

interface AiReportDialogProps {
  result: AiDetectionResult;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const riskStyles: Record<string, { badge: string; score: string }> = {
  Low: {
    badge: 'bg-green-500/20 text-green-400 border-green-500/30',
    score: 'text-green-400',
  },
  Moderate: {
    badge: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    score: 'text-yellow-400',
  },
  High: {
    badge: 'bg-red-500/20 text-red-400 border-red-500/30',
    score: 'text-red-400',
  },
};

function getSignalColor(score: number) {
  if (score <= 2) return { text: 'text-green-500', border: 'border-l-green-500', bg: 'bg-green-500/5', hex: '#22c55e' };
  if (score === 3) return { text: 'text-yellow-500', border: 'border-l-yellow-500', bg: 'bg-yellow-500/5', hex: '#eab308' };
  return { text: 'text-red-500', border: 'border-l-red-500', bg: 'bg-red-500/5', hex: '#ef4444' };
}

function SignalDetailCard({ signal }: { signal: SignalResult }) {
  const colors = getSignalColor(signal.score);
  const hasExamples =
    signal.examples.length > 0 &&
    signal.examples[0] !== 'No specific issues found';

  return (
    <div className={`rounded-lg border-l-4 ${colors.border} ${colors.bg} p-4`}>
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm font-bold text-muted-foreground">
          #{signal.signalId}
        </span>
        <span className="text-sm font-semibold text-foreground flex-1">
          {signal.name}
        </span>
        <span className={`text-lg font-bold ${colors.text}`}>
          {signal.score}/5
        </span>
        <span className="text-xs text-muted-foreground">
          Weight: {signal.weight}x
        </span>
      </div>
      <p className="text-xs font-mono text-muted-foreground mt-2">
        {signal.detail}
      </p>
      {hasExamples && (
        <ul className="mt-2 space-y-1 pl-4">
          {signal.examples.map((ex, i) => (
            <li
              key={i}
              className="text-xs text-muted-foreground list-disc"
            >
              {ex}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function AiReportDialog({
  result,
  open,
  onOpenChange,
}: AiReportDialogProps) {
  const colors = riskStyles[result.riskLevel];

  const topIssues = useMemo(() => {
    return [...result.signals]
      .filter((s) => s.score >= 3)
      .sort((a, b) => {
        const impactA = a.score * a.weight;
        const impactB = b.score * b.weight;
        if (impactB !== impactA) return impactB - impactA;
        return b.score - a.score;
      })
      .slice(0, 5);
  }, [result.signals]);

  const signalsByCategory = useMemo(() => {
    const red = result.signals.filter((s) => s.score >= 4);
    const yellow = result.signals.filter((s) => s.score === 3);
    const green = result.signals.filter((s) => s.score <= 2);
    return { red, yellow, green };
  }, [result.signals]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl w-[95vw] h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-4 shrink-0">
          <DialogTitle className="text-xl">
            AI Signal Analysis Report
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            21 NLP Signal Classifiers &middot; AI Origin Framework
          </p>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 pb-6">
          <div className="space-y-6">
            {/* Overview */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-xl border border-border bg-card p-5">
                <p className={`text-5xl font-bold tabular-nums ${colors.score}`}>
                  {result.compositeScore.toFixed(2)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Composite Score (1=Human, 5=AI)
                </p>
                <div className="mt-3">
                  <Badge
                    variant="outline"
                    className={`text-base font-bold px-4 py-1 ${colors.badge}`}
                  >
                    {result.riskLevel}
                  </Badge>
                </div>
              </div>
              <div className="rounded-xl border border-border bg-card p-5">
                <div className="flex gap-6">
                  <div className="text-center">
                    <p className="text-2xl font-semibold tabular-nums">
                      {result.wordCount}
                    </p>
                    <p className="text-xs text-muted-foreground">Words</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-semibold tabular-nums">
                      {result.sentenceCount}
                    </p>
                    <p className="text-xs text-muted-foreground">Sentences</p>
                  </div>
                  <div className="text-center">
                    <p className="text-2xl font-semibold tabular-nums">
                      {result.paragraphCount}
                    </p>
                    <p className="text-xs text-muted-foreground">Paragraphs</p>
                  </div>
                </div>
                <div className="flex gap-4 mt-4">
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="w-2.5 h-2.5 rounded-full bg-green-500" />
                    Human (1-2)
                  </span>
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="w-2.5 h-2.5 rounded-full bg-yellow-500" />
                    Ambiguous (3)
                  </span>
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
                    AI Signal (4-5)
                  </span>
                </div>
                <div className="flex gap-2 mt-3">
                  <Badge variant="secondary" className="text-xs">
                    {signalsByCategory.green.length} clean
                  </Badge>
                  <Badge variant="secondary" className="text-xs">
                    {signalsByCategory.yellow.length} ambiguous
                  </Badge>
                  <Badge variant="secondary" className="text-xs">
                    {signalsByCategory.red.length} flagged
                  </Badge>
                </div>
              </div>
            </div>

            {/* Radar Chart — larger in the dialog */}
            <div className="rounded-xl border border-border bg-card p-5">
              <h2 className="text-base font-semibold mb-2">Signal Radar</h2>
              <div style={{ height: 420 }}>
                <SignalRadarChart signals={result.signals} size="large" />
              </div>
            </div>

            {/* Top Issues */}
            {topIssues.length > 0 && (
              <div className="rounded-xl border border-border bg-card p-5">
                <div className="flex items-center gap-2 mb-3">
                  <AlertTriangle className="h-4 w-4 text-yellow-500" />
                  <h2 className="text-base font-semibold">Top Issues</h2>
                </div>
                <div className="space-y-3">
                  {topIssues.map((s) => {
                    const c = getSignalColor(s.score);
                    return (
                      <div
                        key={s.signalId}
                        className="pb-3 border-b border-border last:border-b-0 last:pb-0"
                      >
                        <div className="flex items-center gap-2">
                          <span className={`font-bold text-sm ${c.text}`}>
                            #{s.signalId} {s.name}
                          </span>
                          <span className={`text-xs font-bold ${c.text}`}>
                            (Score: {s.score}/5)
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {s.detail}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <Separator />

            {/* All 21 Signals */}
            <div>
              <h2 className="text-base font-semibold mb-3">
                All 21 Signals
              </h2>
              <div className="space-y-2">
                {result.signals.map((signal) => (
                  <SignalDetailCard key={signal.signalId} signal={signal} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
