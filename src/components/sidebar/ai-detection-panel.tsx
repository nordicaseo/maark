'use client';

import { useState, useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { SignalRadarChart } from './signal-radar-chart';
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  AlertTriangle,
  Expand,
} from 'lucide-react';
import type { AiDetectionResult, SignalResult } from '@/types/analysis';

interface AiDetectionPanelProps {
  result: AiDetectionResult | null;
  analyzing: boolean;
  onOpenReport?: () => void;
}

/* ── colour helpers ────────────────────────────────── */

const riskColors = {
  Low: {
    badge: 'bg-green-500/20 text-green-400 border-green-500/30',
    score: 'text-green-400',
    glow: 'shadow-green-500/10',
  },
  Moderate: {
    badge: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    score: 'text-yellow-400',
    glow: 'shadow-yellow-500/10',
  },
  High: {
    badge: 'bg-red-500/20 text-red-400 border-red-500/30',
    score: 'text-red-400',
    glow: 'shadow-red-500/10',
  },
};

function getSignalColors(score: number) {
  if (score <= 2) return { text: 'text-green-500', border: 'border-l-green-500', bg: 'bg-green-500/5', bar: 'bg-green-500', dot: '#22c55e' };
  if (score === 3) return { text: 'text-yellow-500', border: 'border-l-yellow-500', bg: 'bg-yellow-500/5', bar: 'bg-yellow-500', dot: '#eab308' };
  return { text: 'text-red-500', border: 'border-l-red-500', bg: 'bg-red-500/5', bar: 'bg-red-500', dot: '#ef4444' };
}

/* ── top issues ────────────────────────────────────── */

function TopIssues({ signals }: { signals: SignalResult[] }) {
  const issues = useMemo(() => {
    return [...signals]
      .filter((s) => s.score >= 3)
      .sort((a, b) => {
        const impactA = a.score * a.weight;
        const impactB = b.score * b.weight;
        if (impactB !== impactA) return impactB - impactA;
        return b.score - a.score;
      })
      .slice(0, 5);
  }, [signals]);

  if (issues.length === 0) {
    return (
      <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-3">
        <p className="text-xs text-green-400 font-medium">
          No major AI signals detected. Content looks human-written.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-2">
      <div className="flex items-center gap-1.5 mb-1">
        <AlertTriangle className="h-3.5 w-3.5 text-yellow-500" />
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Top Issues
        </h3>
      </div>
      {issues.map((s) => {
        const colors = getSignalColors(s.score);
        return (
          <div key={s.signalId} className="flex items-start gap-2">
            <span className={`text-xs font-bold tabular-nums mt-0.5 ${colors.text}`}>
              {s.score}/5
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-foreground truncate">
                #{s.signalId} {s.name}
              </p>
              <p className="text-[11px] text-muted-foreground truncate">
                {s.detail}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── signal card ───────────────────────────────────── */

function SignalCard({ signal }: { signal: SignalResult }) {
  const [expanded, setExpanded] = useState(false);
  const colors = getSignalColors(signal.score);

  return (
    <div className={`rounded-lg overflow-hidden border-l-[3px] ${colors.border} ${colors.bg}`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 p-2 hover:bg-accent/30 transition-colors text-left"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
        )}
        <span className="text-[10px] text-muted-foreground w-4 shrink-0">
          {signal.signalId}
        </span>
        <span className="text-xs flex-1 truncate">{signal.name}</span>
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="flex gap-[2px]">
            {[1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className={`w-1 h-3 rounded-[1px] ${
                  i <= signal.score ? colors.bar : 'bg-muted/20'
                }`}
              />
            ))}
          </div>
          <span className={`text-[11px] font-bold tabular-nums ${colors.text}`}>
            {signal.score}
          </span>
        </div>
      </button>
      {expanded && (
        <div className="px-3 pb-2.5 pt-0.5">
          <p className="text-[10px] font-mono text-muted-foreground mb-1.5 leading-relaxed">
            {signal.detail}
          </p>
          {signal.examples.length > 0 &&
            signal.examples[0] !== 'No specific issues found' && (
              <ul className="space-y-0.5 mb-1.5">
                {signal.examples.map((ex, i) => (
                  <li
                    key={i}
                    className="text-[10px] text-muted-foreground flex gap-1.5 leading-relaxed"
                  >
                    <span className={`shrink-0 ${colors.text}`}>-</span>
                    <span className="break-words">{ex}</span>
                  </li>
                ))}
              </ul>
            )}
          <span className="text-[9px] text-muted-foreground/60">
            Weight: {signal.weight}x
          </span>
        </div>
      )}
    </div>
  );
}

/* ── legend ─────────────────────────────────────────── */

function ScoreLegend() {
  return (
    <div className="flex items-center justify-center gap-4 text-[10px] text-muted-foreground">
      <span className="flex items-center gap-1">
        <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
        Human (1-2)
      </span>
      <span className="flex items-center gap-1">
        <span className="w-2 h-2 rounded-full bg-yellow-500 inline-block" />
        Ambiguous (3)
      </span>
      <span className="flex items-center gap-1">
        <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
        AI Signal (4-5)
      </span>
    </div>
  );
}

/* ── main panel ─────────────────────────────────────── */

export function AiDetectionPanel({
  result,
  analyzing,
  onOpenReport,
}: AiDetectionPanelProps) {
  if (analyzing) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin mb-3" />
        <p className="text-sm">Analyzing 21 signals...</p>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p className="text-sm">Click &quot;Analyze&quot; to run AI detection</p>
        <p className="text-xs mt-1">Scores 21 NLP signals on a 1-5 scale</p>
      </div>
    );
  }

  const colors = riskColors[result.riskLevel];

  return (
    <div className="space-y-4">
      {/* ── Composite Score Header ── */}
      <div className={`rounded-xl border border-border bg-card p-4 shadow-md ${colors.glow}`}>
        <div className="flex items-center justify-between">
          <div>
            <p className={`text-4xl font-bold tabular-nums ${colors.score}`}>
              {result.compositeScore.toFixed(2)}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Composite Score (1=Human, 5=AI)
            </p>
          </div>
          <Badge
            variant="outline"
            className={`text-sm font-bold px-3 py-1 ${colors.badge}`}
          >
            {result.riskLevel}
          </Badge>
        </div>
        <div className="flex gap-6 mt-3 pt-3 border-t border-border">
          <div className="text-center">
            <p className="text-lg font-semibold text-foreground tabular-nums">
              {result.wordCount}
            </p>
            <p className="text-[10px] text-muted-foreground">Words</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-semibold text-foreground tabular-nums">
              {result.sentenceCount}
            </p>
            <p className="text-[10px] text-muted-foreground">Sentences</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-semibold text-foreground tabular-nums">
              {result.paragraphCount}
            </p>
            <p className="text-[10px] text-muted-foreground">Paragraphs</p>
          </div>
        </div>
      </div>

      {/* ── Legend ── */}
      <ScoreLegend />

      {/* ── Radar Chart ── */}
      <div className="rounded-xl border border-border bg-card p-3">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Signal Radar
          </h3>
          {onOpenReport && (
            <button
              onClick={onOpenReport}
              className="text-muted-foreground hover:text-foreground transition-colors"
              title="Full Report"
            >
              <Expand className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <SignalRadarChart signals={result.signals} />
      </div>

      {/* ── Top Issues ── */}
      <TopIssues signals={result.signals} />

      {/* ── All Signals ── */}
      <div>
        <h3 className="text-xs font-semibold mb-2 text-muted-foreground uppercase tracking-wider">
          All 21 Signals
        </h3>
        <div className="space-y-1">
          {result.signals.map((signal) => (
            <SignalCard key={signal.signalId} signal={signal} />
          ))}
        </div>
      </div>
    </div>
  );
}
