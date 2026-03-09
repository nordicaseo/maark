'use client';

import { useState } from 'react';
import { CheckCircle2, AlertTriangle, ChevronDown } from 'lucide-react';
import type { ParsedReview } from '@/lib/activity-feed/parse-review';
import { MetricPill } from './metric-pill';

interface ReviewSectionProps {
  review: ParsedReview;
  initialExpanded?: boolean;
}

const INITIAL_SHOW = 2;

export function ReviewSection({ review, initialExpanded = false }: ReviewSectionProps) {
  const [expanded, setExpanded] = useState(initialExpanded);
  const hasStrengths = review.strengths.length > 0;
  const hasBlockers = review.blockers.length > 0;
  const hasMetrics = review.metrics.length > 0;
  const hasChecklist = review.checklist.length > 0;

  if (!hasStrengths && !hasBlockers && !hasMetrics && !hasChecklist) return null;

  return (
    <div className="mt-1.5 space-y-1.5">
      {/* Metrics row */}
      {hasMetrics && (
        <div className="flex flex-wrap gap-1">
          {review.metrics.map((m, i) => (
            <MetricPill key={i} label={m.label} value={m.value} color={m.color} />
          ))}
        </div>
      )}

      {/* Strengths */}
      {hasStrengths && (
        <div className="mc-review-section mc-review-strengths">
          {(expanded ? review.strengths : review.strengths.slice(0, INITIAL_SHOW)).map(
            (item, i) => (
              <div
                key={i}
                className="flex items-start gap-1.5 text-[11px] leading-relaxed py-0.5"
                style={{ color: 'var(--mc-text-secondary)' }}
              >
                <CheckCircle2 className="h-3 w-3 shrink-0 mt-0.5" style={{ color: '#3a9567' }} />
                <span>{item}</span>
              </div>
            ),
          )}
          {!expanded && review.strengths.length > INITIAL_SHOW && (
            <button
              onClick={() => setExpanded(true)}
              className="flex items-center gap-0.5 text-[10px] mt-0.5 cursor-pointer hover:underline"
              style={{ color: 'var(--mc-text-tertiary)' }}
            >
              <ChevronDown className="h-2.5 w-2.5" />
              {review.strengths.length - INITIAL_SHOW} more
            </button>
          )}
        </div>
      )}

      {/* Blockers */}
      {hasBlockers && (
        <div className="mc-review-section mc-review-blockers">
          {(expanded ? review.blockers : review.blockers.slice(0, INITIAL_SHOW)).map(
            (item, i) => (
              <div
                key={i}
                className="flex items-start gap-1.5 text-[11px] leading-relaxed py-0.5"
                style={{ color: 'var(--mc-text-secondary)' }}
              >
                <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" style={{ color: '#c55342' }} />
                <span>{item}</span>
              </div>
            ),
          )}
          {!expanded && review.blockers.length > INITIAL_SHOW && (
            <button
              onClick={() => setExpanded(true)}
              className="flex items-center gap-0.5 text-[10px] mt-0.5 cursor-pointer hover:underline"
              style={{ color: 'var(--mc-text-tertiary)' }}
            >
              <ChevronDown className="h-2.5 w-2.5" />
              {review.blockers.length - INITIAL_SHOW} more
            </button>
          )}
        </div>
      )}

      {/* Checklist */}
      {hasChecklist && (
        <div className="mc-review-section" style={{ borderLeftColor: 'var(--mc-text-tertiary)' }}>
          {(expanded ? review.checklist : review.checklist.slice(0, INITIAL_SHOW)).map(
            (item, i) => (
              <div
                key={i}
                className="flex items-start gap-1.5 text-[11px] leading-relaxed py-0.5"
                style={{ color: 'var(--mc-text-secondary)' }}
              >
                <span className="shrink-0 mt-0.5">{item.checked ? '✓' : '○'}</span>
                <span className={item.checked ? 'line-through opacity-60' : ''}>{item.text}</span>
              </div>
            ),
          )}
          {!expanded && review.checklist.length > INITIAL_SHOW && (
            <button
              onClick={() => setExpanded(true)}
              className="flex items-center gap-0.5 text-[10px] mt-0.5 cursor-pointer hover:underline"
              style={{ color: 'var(--mc-text-tertiary)' }}
            >
              <ChevronDown className="h-2.5 w-2.5" />
              {review.checklist.length - INITIAL_SHOW} more
            </button>
          )}
        </div>
      )}
    </div>
  );
}
