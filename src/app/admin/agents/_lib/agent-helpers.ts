import {
  AGENT_KNOWLEDGE_PART_TYPES,
  type AgentFileKey,
  type AgentKnowledgePart,
  type AgentRole,
  type ProjectAgentFileBundle,
  type ProjectAgentModelOverrides,
  type ProjectAgentProfile,
} from '@/types/agent-profile';
import type { AgentLaneKey } from '@/types/agent-runtime';

export interface ProfileDraft {
  displayName: string;
  emoji: string;
  avatarUrl: string;
  shortDescription: string;
  mission: string;
  isEnabled: boolean;
  fileBundle: ProjectAgentFileBundle;
  knowledgeParts: AgentKnowledgePart[];
  modelOverrides: ProjectAgentModelOverrides;
}

export const FILE_HINTS: Record<AgentFileKey, string> = {
  SOUL: 'Agent personality, non-negotiables, and quality standards.',
  IDENTITY: 'Short identity card (name, mission, role, emoji).',
  HEARTBEAT: 'Manual heartbeat protocol and cadence.',
  AGENTS: 'Collaboration rules and handoff behavior.',
  TOOLS: 'Environment notes, shortcuts, and runtime constraints.',
  MEMORY: 'Long-term notes automatically appended by workflow activity.',
  WORKING: 'Current working state updated by workflow stage events.',
  BOOTSTRAP: 'First-run startup checklist for this role profile.',
};

export const EMPTY_FILE_BUNDLE: ProjectAgentFileBundle = {
  SOUL: '',
  IDENTITY: '',
  HEARTBEAT: '',
  AGENTS: '',
  TOOLS: '',
  MEMORY: '',
  WORKING: '',
  BOOTSTRAP: '',
};

export function roleLabel(role: AgentRole): string {
  return role
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function laneLabel(lane: AgentLaneKey): string {
  return lane.charAt(0).toUpperCase() + lane.slice(1);
}

export function formatDate(value?: string | null) {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleString();
}

export function mapProfileToDraft(profile: ProjectAgentProfile | null): ProfileDraft {
  if (!profile) {
    return {
      displayName: '',
      emoji: '',
      avatarUrl: '',
      shortDescription: '',
      mission: '',
      isEnabled: true,
      fileBundle: { ...EMPTY_FILE_BUNDLE },
      knowledgeParts: [],
      modelOverrides: {},
    };
  }
  return {
    displayName: profile.displayName || '',
    emoji: profile.emoji || '',
    avatarUrl: profile.avatarUrl || '',
    shortDescription: profile.shortDescription || '',
    mission: profile.mission || '',
    isEnabled: profile.isEnabled,
    fileBundle: { ...EMPTY_FILE_BUNDLE, ...profile.fileBundle },
    knowledgeParts: profile.knowledgeParts || [],
    modelOverrides: profile.modelOverrides || {},
  };
}

export function knowledgePartValue(
  parts: AgentKnowledgePart[],
  partType: (typeof AGENT_KNOWLEDGE_PART_TYPES)[number]
): string {
  return parts.find((part) => part.partType === partType)?.content || '';
}

export function upsertKnowledgePart(
  parts: AgentKnowledgePart[],
  partType: (typeof AGENT_KNOWLEDGE_PART_TYPES)[number],
  content: string
): AgentKnowledgePart[] {
  const trimmed = content.trim();
  const existing = parts.find((part) => part.partType === partType);
  if (!trimmed) {
    return parts.filter((part) => part.partType !== partType);
  }
  if (existing) {
    return parts.map((part) =>
      part.partType === partType ? { ...part, content: trimmed } : part
    );
  }
  return [
    ...parts,
    {
      id: `${partType}:${parts.length}`,
      partType,
      label: partType.replace(/_/g, ' '),
      content: trimmed,
      sortOrder: parts.length,
    },
  ];
}
