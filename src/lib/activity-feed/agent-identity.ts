// ── Agent Visual Identity ──────────────────────────────────────
// Maps agent names/roles to visual identity for the activity feed.
// No DB columns needed — derived purely from actorName, actorType, stageKey.

import {
  TOPIC_STAGE_OWNER_CHAINS,
  type TopicStageKey,
} from '@/lib/content-workflow-taxonomy';

export interface AgentVisualIdentity {
  initials: string;
  color: string;
  bgColor: string;
  displayRole: string;
}

// ── Color palette ──────────────────────────────────────────────

const COLORS = {
  writer:     { color: '#266847', bgColor: 'rgba(58,149,103,0.11)' },
  editor:     { color: '#895e23', bgColor: 'rgba(209,151,69,0.12)' },
  researcher: { color: '#1d5a9e', bgColor: 'rgba(74,158,218,0.12)' },
  outliner:   { color: '#6b4fa0', bgColor: 'rgba(139,108,193,0.12)' },
  seo:        { color: '#1d6f6f', bgColor: 'rgba(45,138,138,0.12)' },
  pm:         { color: '#7a5e3e', bgColor: 'rgba(158,124,90,0.12)' },
  lead:       { color: '#9e5a28', bgColor: 'rgba(198,115,50,0.12)' },
  system:     { color: '#6b6259', bgColor: 'rgba(144,129,111,0.10)' },
  user:       { color: '#9e5a28', bgColor: 'rgba(198,115,50,0.12)' },
} as const;

// ── Identity map ───────────────────────────────────────────────

type IdentityEntry = AgentVisualIdentity;

const IDENTITY_MAP: Record<string, IdentityEntry> = {
  // By role
  writer:            { initials: 'W',  ...COLORS.writer,     displayRole: 'Writer' },
  editor:            { initials: 'E',  ...COLORS.editor,     displayRole: 'Editor' },
  researcher:        { initials: 'R',  ...COLORS.researcher, displayRole: 'Researcher' },
  outliner:          { initials: 'O',  ...COLORS.outliner,   displayRole: 'Outliner' },
  'seo-reviewer':    { initials: 'SR', ...COLORS.seo,        displayRole: 'SEO Reviewer' },
  seo:               { initials: 'S',  ...COLORS.seo,        displayRole: 'SEO' },
  'project-manager': { initials: 'PM', ...COLORS.pm,         displayRole: 'Project Manager' },
  content:           { initials: 'C',  ...COLORS.outliner,   displayRole: 'Content' },
  lead:              { initials: 'L',  ...COLORS.lead,       displayRole: 'Lead' },

  // By named agent
  atlas:  { initials: 'At', ...COLORS.writer,     displayRole: 'Writer' },
  quill:  { initials: 'Qu', ...COLORS.editor,     displayRole: 'Editor' },
  sage:   { initials: 'Sa', ...COLORS.researcher, displayRole: 'Researcher' },
  maple:  { initials: 'Ma', ...COLORS.outliner,   displayRole: 'Outliner' },
  orion:  { initials: 'Or', ...COLORS.seo,        displayRole: 'SEO Reviewer' },
  pulse:  { initials: 'Pu', ...COLORS.pm,         displayRole: 'Project Manager' },
  helix:  { initials: 'He', ...COLORS.seo,        displayRole: 'SEO' },
  lumen:  { initials: 'Lu', ...COLORS.outliner,   displayRole: 'Content' },
  astra:  { initials: 'As', ...COLORS.lead,       displayRole: 'Lead' },

  // Special
  system:      { initials: 'SY', ...COLORS.system, displayRole: 'System' },
  'workflow pm': { initials: 'PM', ...COLORS.pm,   displayRole: 'Project Manager' },
};

// ── Stage → primary role lookup ────────────────────────────────

const STAGE_KEYS = new Set([
  'research', 'seo_intel_review', 'outline_build', 'outline_review',
  'prewrite_context', 'writing', 'editing', 'final_review',
  'human_review', 'complete',
]);

function primaryRoleForStage(stageKey: string): string | null {
  if (!STAGE_KEYS.has(stageKey)) return null;
  const chain = TOPIC_STAGE_OWNER_CHAINS[stageKey as TopicStageKey];
  return chain?.[0] ?? null;
}

// ── Resolver ───────────────────────────────────────────────────

/**
 * Resolves the visual identity for an event actor.
 * Tries: actorName match → stageKey inference → actorType fallback.
 */
export function resolveAgentIdentity(
  actorName?: string | null,
  actorType?: string | null,
  stageKey?: string | null,
): AgentVisualIdentity {
  // 1. Try matching actorName (e.g. "Atlas", "Sage (researcher)", "Workflow PM")
  if (actorName) {
    const normalized = actorName.toLowerCase().trim();
    // Exact match
    if (IDENTITY_MAP[normalized]) return IDENTITY_MAP[normalized];
    // First word match (handles "Atlas (writer)" patterns)
    const firstName = normalized.split(/[\s(]/)[0];
    if (firstName && IDENTITY_MAP[firstName]) return IDENTITY_MAP[firstName];
  }

  // 2. Try inferring from stageKey
  if (stageKey) {
    const role = primaryRoleForStage(stageKey);
    if (role && IDENTITY_MAP[role]) return IDENTITY_MAP[role];
  }

  // 3. Fallback based on actorType
  if (actorType === 'user' || actorType === 'human') {
    const initials = actorName
      ? actorName.split(/\s+/).map((w) => w[0]?.toUpperCase()).filter(Boolean).slice(0, 2).join('')
      : 'U';
    return { initials, ...COLORS.user, displayRole: 'User' };
  }

  if (actorType === 'system' || actorType === 'workflow') {
    return IDENTITY_MAP.system;
  }

  // 4. Ultimate fallback
  return { initials: 'AI', ...COLORS.system, displayRole: 'Agent' };
}
