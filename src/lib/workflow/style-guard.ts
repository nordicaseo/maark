import type { StyleGuardPolicy } from '@/types/content-template-config';

export interface StyleGuardMetrics {
  emDashCount: number;
  enDashCount: number;
  narrativeColonCount: number;
}

export interface StyleGuardResult {
  html: string;
  metrics: StyleGuardMetrics;
  changed: boolean;
}

function countMatches(input: string, re: RegExp): number {
  const matches = input.match(re);
  return matches ? matches.length : 0;
}

function splitHeadingSegments(html: string): Array<{ heading: boolean; value: string }> {
  const headingRegex = /(<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>)/gi;
  const parts = html.split(headingRegex);
  return parts
    .filter((part) => part.length > 0)
    .map((part) => ({
      heading: /^<h[1-6][^>]*>[\s\S]*<\/h[1-6]>$/i.test(part),
      value: part,
    }));
}

function countNarrativeColons(html: string): number {
  return splitHeadingSegments(html)
    .filter((segment) => !segment.heading)
    .reduce((acc, segment) => acc + countMatches(segment.value, /:/g), 0);
}

function removeNarrativeColons(html: string): string {
  return splitHeadingSegments(html)
    .map((segment) =>
      segment.heading ? segment.value : segment.value.replace(/:/g, ',')
    )
    .join('');
}

export function applyStyleGuard(html: string, policy: StyleGuardPolicy): StyleGuardResult {
  let normalized = html;
  const before = normalized;

  if (policy.emDash === 'forbid') {
    normalized = normalized.replace(/[—–]/g, ',');
  }

  const colonPolicy = policy.colon || 'structural_only';
  if (colonPolicy === 'forbid') {
    normalized = removeNarrativeColons(normalized);
    normalized = normalized.replace(/:/g, ',');
  } else if (colonPolicy === 'structural_only') {
    const allowed = Math.max(0, policy.maxNarrativeColons || 0);
    let currentNarrativeColons = countNarrativeColons(normalized);
    if (currentNarrativeColons > allowed) {
      normalized = removeNarrativeColons(normalized);
      currentNarrativeColons = countNarrativeColons(normalized);
      if (currentNarrativeColons > allowed) {
        normalized = normalized.replace(/:/g, ',');
      }
    }
  }

  const metrics: StyleGuardMetrics = {
    emDashCount: countMatches(normalized, /—/g),
    enDashCount: countMatches(normalized, /–/g),
    narrativeColonCount: countNarrativeColons(normalized),
  };

  return {
    html: normalized,
    metrics,
    changed: normalized !== before,
  };
}

export function styleGuardPassed(
  metrics: StyleGuardMetrics,
  policy: StyleGuardPolicy
): boolean {
  if (policy.emDash === 'forbid' && (metrics.emDashCount > 0 || metrics.enDashCount > 0)) {
    return false;
  }
  if (policy.colon === 'forbid') return metrics.narrativeColonCount === 0;
  if (policy.colon === 'structural_only') {
    return metrics.narrativeColonCount <= Math.max(0, policy.maxNarrativeColons || 0);
  }
  return true;
}

