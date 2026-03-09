'use client';

import { ChevronDown, ChevronUp } from 'lucide-react';
import { resolveAgentIdentity } from '@/lib/activity-feed/agent-identity';
import { parseReviewPayload } from '@/lib/activity-feed/parse-review';
import type { FeedGroup } from '@/lib/activity-feed/group-events';
import { AgentAvatar } from './agent-avatar';
import { StatusPill } from './status-pill';
import { MetricPill } from './metric-pill';
import { ReviewSection } from './review-section';

interface FeedItemProps {
  group: FeedGroup;
  onToggleExpand: (groupId: string) => void;
  isExpanded: boolean;
  compact?: boolean;
}

function relativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

export function FeedItem({ group, onToggleExpand, isExpanded, compact }: FeedItemProps) {
  const { representative, humanized, timestamp, count } = group;
  const identity = resolveAgentIdentity(
    representative.actorName,
    representative.actorType,
    representative.stageKey,
  );

  // Parse review content for artifact events
  const review =
    representative.eventType === 'stage_artifact' || representative.eventType === 'approval'
      ? parseReviewPayload(representative.payload as Record<string, unknown> | undefined, representative.summary)
      : null;

  // Background tint for error/warning
  const bgStyle =
    humanized.status === 'error'
      ? 'color-mix(in srgb, var(--mc-urgent) 6%, transparent)'
      : humanized.status === 'warning'
        ? 'color-mix(in srgb, var(--mc-accent) 5%, transparent)'
        : undefined;

  return (
    <div
      className="mc-feed-item-enter flex items-start gap-2.5 p-2 rounded-md hover:bg-[var(--mc-overlay)] transition-colors border-l-[3px]"
      style={{
        borderLeftColor: identity.color,
        background: bgStyle,
      }}
    >
      {/* Avatar */}
      <AgentAvatar identity={identity} size="sm" />

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Headline row */}
        <div className="flex items-start justify-between gap-2">
          <p
            className="text-xs leading-relaxed"
            style={{ color: 'var(--mc-text-secondary)' }}
          >
            <span
              className="font-semibold"
              style={{ color: 'var(--mc-text-primary)' }}
              dangerouslySetInnerHTML={{
                __html: humanized.headline.replace(
                  /\*\*(.*?)\*\*/g,
                  '<strong>$1</strong>',
                ),
              }}
            />
          </p>
          <span
            className="text-[10px] shrink-0 whitespace-nowrap mt-0.5"
            style={{ color: 'var(--mc-text-tertiary)' }}
          >
            {relativeTime(timestamp)}
          </span>
        </div>

        {/* Detail */}
        {humanized.detail && (
          <p
            className="text-[11px] mt-0.5 leading-relaxed"
            style={{ color: 'var(--mc-text-tertiary)' }}
          >
            {humanized.detail}
          </p>
        )}

        {/* Badges */}
        {humanized.badges && humanized.badges.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {humanized.badges.map((badge, i) => (
              <StatusPill key={i} text={badge.text} variant={badge.variant} />
            ))}
          </div>
        )}

        {/* Metrics */}
        {humanized.metrics && humanized.metrics.length > 0 && !compact && (
          <div className="flex flex-wrap gap-1 mt-1">
            {humanized.metrics.map((m, i) => (
              <MetricPill key={i} label={m.label} value={m.value} color={m.color} />
            ))}
          </div>
        )}

        {/* Review section */}
        {review && !compact && <ReviewSection review={review} />}

        {/* Grouped events toggle */}
        {count > 1 && (
          <button
            onClick={() => onToggleExpand(group.id)}
            className="flex items-center gap-0.5 mt-1 cursor-pointer hover:underline"
            style={{ color: 'var(--mc-text-tertiary)' }}
          >
            {isExpanded ? (
              <ChevronUp className="h-2.5 w-2.5" />
            ) : (
              <ChevronDown className="h-2.5 w-2.5" />
            )}
            <span className="text-[10px]">
              {isExpanded ? 'Hide' : `${count - 1} more event${count > 2 ? 's' : ''}`}
            </span>
          </button>
        )}

        {/* Expanded sub-items */}
        {isExpanded && count > 1 && (
          <div className="mc-feed-expand mc-feed-expand-open mt-1 pl-2 border-l border-[var(--mc-border)] space-y-0.5">
            {group.events.slice(1).map((event) => (
              <p
                key={event._id}
                className="text-[10px] leading-relaxed py-0.5"
                style={{ color: 'var(--mc-text-tertiary)' }}
              >
                {event.summary || `${event.eventType} event`}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
