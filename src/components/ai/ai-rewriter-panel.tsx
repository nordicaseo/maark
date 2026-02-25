'use client';

import { useState, useRef, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Loader2,
  Wand2,
  Copy,
  Check,
  X,
  RotateCcw,
  AlertTriangle,
  ArrowDownToLine,
} from 'lucide-react';
import type { AiDetectionResult } from '@/types/analysis';
import type { ContentType } from '@/types/document';

interface AiRewriterPanelProps {
  aiResult: AiDetectionResult;
  plainText: string;
  contentType: ContentType;
  targetKeyword: string | null;
  onReplace: (text: string) => void;
}

export function AiRewriterPanel({
  aiResult,
  plainText,
  contentType,
  targetKeyword,
  onReplace,
}: AiRewriterPanelProps) {
  const [rewriting, setRewriting] = useState(false);
  const [output, setOutput] = useState('');
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const topIssues = useMemo(() => {
    return [...aiResult.signals]
      .filter((s) => s.score >= 3)
      .sort((a, b) => b.score * b.weight - a.score * a.weight)
      .slice(0, 5);
  }, [aiResult.signals]);

  const handleRewrite = useCallback(async () => {
    setRewriting(true);
    setOutput('');

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/ai/rewrite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: plainText,
          signals: aiResult.signals,
          compositeScore: aiResult.compositeScore,
          contentType,
          targetKeyword,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Rewrite failed' }));
        setOutput(`Error: ${err.error || 'Rewrite failed'}`);
        setRewriting(false);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setOutput('Error: No response stream');
        setRewriting(false);
        return;
      }

      const decoder = new TextDecoder();
      let text = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        setOutput(text);
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setOutput(`Error: ${err.message || 'Rewrite failed'}`);
      }
    }

    setRewriting(false);
  }, [plainText, aiResult, contentType, targetKeyword]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
    setRewriting(false);
  }, []);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [output]);

  const handleReplace = useCallback(() => {
    onReplace(output);
    setOutput('');
  }, [output, onReplace]);

  const handleDiscard = useCallback(() => {
    setOutput('');
  }, []);

  const getScoreColor = (score: number) => {
    if (score <= 2) return 'text-green-400';
    if (score === 3) return 'text-yellow-400';
    return 'text-red-400';
  };

  return (
    <div className="space-y-3">
      {/* Current Score Info */}
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-yellow-500" />
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              AI Score: {aiResult.compositeScore.toFixed(2)}
            </span>
          </div>
          <span
            className={`text-xs font-bold ${
              aiResult.riskLevel === 'Low'
                ? 'text-green-400'
                : aiResult.riskLevel === 'Moderate'
                ? 'text-yellow-400'
                : 'text-red-400'
            }`}
          >
            {aiResult.riskLevel} Risk
          </span>
        </div>

        {topIssues.length > 0 && (
          <div className="space-y-1">
            <p className="text-[10px] text-muted-foreground mb-1">Issues the rewriter will fix:</p>
            {topIssues.map((s) => (
              <div key={s.signalId} className="flex items-center gap-2">
                <span className={`text-[10px] font-bold ${getScoreColor(s.score)}`}>
                  {s.score}/5
                </span>
                <span className="text-[11px] text-muted-foreground truncate">
                  {s.name}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Rewrite Button */}
      {!output && !rewriting && (
        <Button
          onClick={handleRewrite}
          className="w-full h-9"
          disabled={!plainText || plainText.length < 50}
        >
          <Wand2 className="h-4 w-4 mr-2" />
          Rewrite to Fix AI Signals
        </Button>
      )}

      {/* Rewriting Status */}
      {rewriting && !output && (
        <div className="flex items-center justify-center gap-2 py-4 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Rewriting article...</span>
        </div>
      )}

      {/* Cancel button during rewrite */}
      {rewriting && (
        <Button
          size="sm"
          variant="destructive"
          onClick={handleCancel}
          className="w-full h-8"
        >
          <X className="h-3.5 w-3.5 mr-1" />
          Stop Rewriting
        </Button>
      )}

      {/* Output */}
      {(output || rewriting) && output && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Rewritten Content
            </label>
            {rewriting && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Writing...
              </div>
            )}
          </div>

          <ScrollArea className="max-h-[350px]">
            <div className="rounded-md border border-border bg-background p-3 text-sm whitespace-pre-wrap leading-relaxed">
              {output}
            </div>
          </ScrollArea>

          {output && !rewriting && (
            <div className="space-y-1.5">
              <Button
                size="sm"
                variant="default"
                onClick={handleReplace}
                className="w-full h-8 text-xs"
              >
                <ArrowDownToLine className="h-3 w-3 mr-1" />
                Replace Article Content
              </Button>
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleCopy}
                  className="h-7 text-xs flex-1"
                >
                  {copied ? (
                    <Check className="h-3 w-3 mr-1" />
                  ) : (
                    <Copy className="h-3 w-3 mr-1" />
                  )}
                  {copied ? 'Copied' : 'Copy'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleRewrite}
                  className="h-7 text-xs flex-1"
                >
                  <RotateCcw className="h-3 w-3 mr-1" />
                  Rewrite Again
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleDiscard}
                  className="h-7 text-xs"
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {!output && !rewriting && aiResult.compositeScore < 2.0 && (
        <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-3">
          <p className="text-xs text-green-400 font-medium">
            Score is already low. Content reads as human-written!
          </p>
          <p className="text-[10px] text-muted-foreground mt-1">
            You can still rewrite if you want further improvements.
          </p>
        </div>
      )}
    </div>
  );
}
