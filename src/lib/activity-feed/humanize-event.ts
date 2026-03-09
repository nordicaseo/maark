// ── Event Humanization ─────────────────────────────────────────
// Translates raw workflow events into human-readable feed items.
// Pure function — no React, no side effects.

import {
  TOPIC_STAGE_LABELS,
  type TopicStageKey,
} from '@/lib/content-workflow-taxonomy';

// ── Types ──────────────────────────────────────────────────────

export interface MetricPill {
  label: string;
  value: string;
  color?: string;
}

export interface Badge {
  text: string;
  variant: 'success' | 'warning' | 'error' | 'info' | 'neutral';
}

export interface HumanizedEvent {
  headline: string;
  detail?: string;
  metrics?: MetricPill[];
  status: 'success' | 'warning' | 'error' | 'info' | 'neutral';
  badges?: Badge[];
}

export interface WorkflowEvent {
  _id: string;
  taskId: string;
  projectId?: number;
  stageKey?: string;
  eventType: string;
  fromStageKey?: string;
  toStageKey?: string;
  actorType?: string;
  actorId?: string;
  actorName?: string;
  summary?: string;
  payload?: Record<string, unknown>;
  createdAt: number;
}

// ── Helpers ────────────────────────────────────────────────────

function stageLabel(key?: string | null): string {
  if (!key) return '';
  return (TOPIC_STAGE_LABELS as Record<string, string>)[key] ?? key;
}

function extractActorDisplay(event: WorkflowEvent): string {
  if (!event.actorName) return '';
  // Strip parenthetical role suffixes: "Atlas (writer)" → "Atlas"
  return event.actorName.replace(/\s*\(.*?\)\s*$/, '').trim();
}

// ── Payload-based metric extraction ────────────────────────────

function extractMetrics(payload?: Record<string, unknown>): MetricPill[] {
  if (!payload) return [];
  const metrics: MetricPill[] = [];

  // From completion data
  const completion = payload.artifact
    ? (payload.artifact as Record<string, unknown>).data as Record<string, unknown> | undefined
    : payload.completion as Record<string, unknown> | undefined;

  if (completion) {
    if (typeof completion.wordCount === 'number') {
      const min = typeof completion.minWords === 'number' ? completion.minWords : null;
      metrics.push({
        label: 'Words',
        value: min ? `${completion.wordCount.toLocaleString()} / ${min.toLocaleString()}` : `${completion.wordCount.toLocaleString()}`,
        color: typeof completion.wordGap === 'number' && completion.wordGap > 0 ? '#c55342' : '#3a9567',
      });
    }
    if (typeof completion.headingCoverage === 'number') {
      const pct = Math.round(completion.headingCoverage * 100);
      metrics.push({
        label: 'Coverage',
        value: `${pct}%`,
        color: pct < 50 ? '#c55342' : pct < 80 ? '#d19745' : '#3a9567',
      });
    }
    if (Array.isArray(completion.missingHeadings) && completion.missingHeadings.length > 0) {
      metrics.push({
        label: 'Missing',
        value: `${completion.missingHeadings.length} sections`,
        color: '#c55342',
      });
    }
  }

  return metrics;
}

// ── Parse failure details ──────────────────────────────────────

function humanizeFailure(summary?: string, payload?: Record<string, unknown>): {
  headline: string;
  detail?: string;
  metrics: MetricPill[];
} {
  const s = summary || '';
  const metrics = extractMetrics(payload);

  // Word count pattern
  const wordMatch = s.match(/word count.*?(\d[\d,]*)\s*.*?(?:below|minimum)\s*(\d[\d,]*)/i);
  if (wordMatch) {
    return {
      headline: 'Draft needs more content',
      detail: `Current word count is ${wordMatch[1]}, minimum is ${wordMatch[2]}`,
      metrics,
    };
  }

  // Coverage pattern
  const covMatch = s.match(/coverage.*?(\d+)%.*?below\s*(\d+)%/i);
  if (covMatch) {
    return {
      headline: 'Insufficient topic coverage',
      detail: `Heading coverage is ${covMatch[1]}%, needs at least ${covMatch[2]}%`,
      metrics,
    };
  }

  // Incomplete draft
  if (/incomplete|abrupt/i.test(s)) {
    return { headline: 'Draft is incomplete', detail: s, metrics };
  }

  // Style guard
  if (/style guard/i.test(s)) {
    return { headline: 'Style guidelines not met', detail: s, metrics };
  }

  // Generic failure
  return {
    headline: 'Stage failed',
    detail: s.replace(/^Stage \w+ failed:\s*/i, '').trim() || undefined,
    metrics,
  };
}

// ── Main humanizer ─────────────────────────────────────────────

/**
 * Translates a raw workflow event into a human-readable representation.
 * Returns `null` for events that should be suppressed (handoffs, bridged).
 */
export function humanizeWorkflowEvent(event: WorkflowEvent): HumanizedEvent | null {
  const actor = extractActorDisplay(event);
  const payload = event.payload || {};
  const status = payload.status as string | undefined;

  switch (event.eventType) {
    // ── Transitions ──────────────────────────────────────────
    case 'transition': {
      const from = stageLabel(event.fromStageKey);
      const to = stageLabel(event.toStageKey);

      if (event.toStageKey === 'complete') {
        return { headline: 'Content published', status: 'success', badges: [{ text: 'Complete', variant: 'success' }] };
      }
      if (event.toStageKey === 'human_review') {
        return { headline: 'Ready for your review', status: 'info', badges: [{ text: 'Needs Review', variant: 'warning' }] };
      }
      return {
        headline: `${from} complete \u2014 moving to ${to}`,
        status: 'success',
      };
    }

    // ── Approvals ────────────────────────────────────────────
    case 'approval': {
      const approved = payload.approved === true;
      const gate = stageLabel(event.stageKey);
      return {
        headline: approved ? `${gate} approved` : `${gate} needs changes`,
        status: approved ? 'success' : 'warning',
        badges: [{ text: approved ? 'Approved' : 'Changes Needed', variant: approved ? 'success' : 'warning' }],
      };
    }

    // ── Artifacts ────────────────────────────────────────────
    case 'stage_artifact': {
      const artifact = payload.artifact as Record<string, unknown> | undefined;
      const title = artifact?.title as string | undefined;
      return {
        headline: actor
          ? `${actor} produced ${title || stageLabel(event.stageKey) + ' output'}`
          : `${title || stageLabel(event.stageKey) + ' output'} ready`,
        status: 'info',
        metrics: extractMetrics(payload),
        badges: payload.deliverable ? [{ text: 'Deliverable', variant: 'info' }] : undefined,
      };
    }

    // ── Resets ────────────────────────────────────────────────
    case 'reset': {
      return {
        headline: `Workflow reset to ${stageLabel(event.toStageKey)}`,
        status: 'warning',
        badges: [{ text: 'Reset', variant: 'warning' }],
      };
    }

    // ── Created ──────────────────────────────────────────────
    case 'created': {
      return {
        headline: 'Workflow started for this topic',
        status: 'info',
      };
    }

    // ── Handoff — suppress (absorbed by grouping) ────────────
    case 'handoff':
      return null;

    // ── Stage Progress ───────────────────────────────────────
    case 'stage_progress': {
      const stage = stageLabel(event.stageKey);

      switch (status) {
        case 'started':
          return {
            headline: actor ? `${actor} is working on ${stage}` : `${stage} started`,
            status: 'info',
          };

        case 'queued':
          return {
            headline: `Waiting for available ${stage.toLowerCase()} agent...`,
            status: 'neutral',
          };

        case 'blocked': {
          const reason = (payload.reason as string) || (payload.reasonCode as string) || '';
          const detail = reason.includes('assignment_blocked')
            ? `No available agents for ${stage}`
            : reason || undefined;
          return {
            headline: `${stage} blocked`,
            detail,
            status: 'error',
            badges: [{ text: 'Blocked', variant: 'error' }],
          };
        }

        case 'failed': {
          const failure = humanizeFailure(event.summary, payload);
          return {
            headline: failure.headline,
            detail: failure.detail,
            status: 'error',
            metrics: failure.metrics.length > 0 ? failure.metrics : undefined,
            badges: [{ text: 'Failed', variant: 'error' }],
          };
        }

        case 'revision_required': {
          const attempt = payload.revisionAttempt as number | undefined;
          return {
            headline: 'Revisions needed \u2014 routing back to writing',
            detail: attempt ? `Revision attempt ${attempt}` : undefined,
            status: 'warning',
            badges: [{ text: 'Revision', variant: 'warning' }],
          };
        }

        case 'skipped':
          return {
            headline: `${stage} skipped`,
            status: 'neutral',
          };

        case 'bridged':
          return null;

        case 'completed':
          return {
            headline: actor ? `${actor} completed ${stage}` : `${stage} completed`,
            status: 'success',
          };

        default:
          // Generic progress
          return {
            headline: actor ? `${actor} \u2014 ${stage}: ${status || 'in progress'}` : `${stage}: ${status || 'in progress'}`,
            status: 'info',
          };
      }
    }

    // ── Assignment events ────────────────────────────────────
    case 'assignment':
    case 'assignment_queued':
      return {
        headline: actor
          ? `${actor} assigned to ${stageLabel(event.stageKey)}`
          : `Agent assigned to ${stageLabel(event.stageKey)}`,
        status: 'info',
      };

    case 'assignment_blocked':
      return {
        headline: `No available agent for ${stageLabel(event.stageKey)}`,
        status: 'error',
        badges: [{ text: 'Blocked', variant: 'error' }],
      };

    // ── Fallback ─────────────────────────────────────────────
    default:
      return {
        headline: event.summary || `${event.eventType} event`,
        status: 'neutral',
      };
  }
}
