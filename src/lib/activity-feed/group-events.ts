// ── Event Grouping ─────────────────────────────────────────────
// Batches rapid-fire workflow events into groups for the feed UI.
// Pure function — no React, no side effects.

import {
  humanizeWorkflowEvent,
  type HumanizedEvent,
  type WorkflowEvent,
} from './humanize-event';

// ── Types ──────────────────────────────────────────────────────

export interface FeedGroup {
  id: string;
  events: WorkflowEvent[];
  representative: WorkflowEvent;
  humanized: HumanizedEvent;
  timestamp: number;
  count: number;
}

// ── Priority for representative selection ──────────────────────

const EVENT_TYPE_PRIORITY: Record<string, number> = {
  transition: 0,
  reset: 1,
  approval: 2,
  stage_artifact: 3,
  stage_progress: 4,
  assignment: 5,
  assignment_queued: 6,
  assignment_blocked: 7,
  created: 8,
};

function eventPriority(event: WorkflowEvent): number {
  return EVENT_TYPE_PRIORITY[event.eventType] ?? 9;
}

// ── Group key generation ───────────────────────────────────────

function groupKey(event: WorkflowEvent, windowMs: number): string {
  const stage = event.stageKey || '_';
  const actor = event.actorName || event.actorType || '_';
  const timeSlot = Math.floor(event.createdAt / windowMs);
  return `${stage}::${actor}::${timeSlot}`;
}

// ── Should event be suppressed? ────────────────────────────────

function isSuppressedType(eventType: string): boolean {
  return eventType === 'handoff' || eventType === 'bridged';
}

// ── Main grouping function ─────────────────────────────────────

/**
 * Groups workflow events by stage + actor + time window.
 * Suppresses handoff/bridged events. Selects the most important
 * event in each group as the representative.
 *
 * @param events - Events in descending order (newest first)
 * @param windowMs - Time window for grouping (default 3 seconds)
 */
export function groupFeedEvents(
  events: WorkflowEvent[],
  windowMs = 3000,
): FeedGroup[] {
  const groups: FeedGroup[] = [];
  let currentKey = '';
  let currentEvents: WorkflowEvent[] = [];

  function flushGroup() {
    if (currentEvents.length === 0) return;

    // Select representative by priority
    const sorted = [...currentEvents].sort(
      (a, b) => eventPriority(a) - eventPriority(b),
    );
    const representative = sorted[0];
    const humanized = humanizeWorkflowEvent(representative);

    // Only create group if humanization succeeds
    if (humanized) {
      groups.push({
        id: representative._id,
        events: currentEvents,
        representative,
        humanized,
        timestamp: currentEvents[0].createdAt,
        count: currentEvents.length,
      });
    }

    currentEvents = [];
  }

  for (const event of events) {
    // Skip suppressed types entirely
    if (isSuppressedType(event.eventType)) continue;

    // Humanize to check if the event would render
    const testHumanized = humanizeWorkflowEvent(event);
    if (!testHumanized) continue;

    const key = groupKey(event, windowMs);

    if (key !== currentKey) {
      flushGroup();
      currentKey = key;
    }

    currentEvents.push(event);
  }

  // Flush last group
  flushGroup();

  return groups;
}
