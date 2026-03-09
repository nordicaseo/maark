import type { AgentLaneKey } from './agent-runtime';

export const FIXED_AGENT_ROLES = [
  'researcher',
  'outliner',
  'writer',
  'editor',
  'seo-reviewer',
  'project-manager',
  'seo',
  'content',
  'lead',
] as const;

export type AgentRole = (typeof FIXED_AGENT_ROLES)[number];

export const AGENT_FILE_KEYS = [
  'SOUL',
  'IDENTITY',
  'HEARTBEAT',
  'AGENTS',
  'TOOLS',
  'MEMORY',
  'WORKING',
  'BOOTSTRAP',
] as const;

export type AgentFileKey = (typeof AGENT_FILE_KEYS)[number];

export const AGENT_KNOWLEDGE_PART_TYPES = [
  'brand_identity',
  'brand_voice',
  'technical',
  'content_structure',
  'seo',
  'compliance',
  'custom',
] as const;

export type AgentKnowledgePartType = (typeof AGENT_KNOWLEDGE_PART_TYPES)[number];

export interface AgentKnowledgePart {
  id: string;
  partType: AgentKnowledgePartType;
  label: string;
  content: string;
  sortOrder: number;
}

export const SHARED_AGENT_PROFILE_KEYS = {
  USER_MD: 'USER_MD',
} as const;

export type SharedAgentProfileKey =
  (typeof SHARED_AGENT_PROFILE_KEYS)[keyof typeof SHARED_AGENT_PROFILE_KEYS];

export type ProjectAgentFileBundle = Record<AgentFileKey, string>;

export interface ProjectAgentModelOverride {
  provider?: string;
  modelId?: string;
  temperature?: number;
}

export type ProjectAgentModelOverrides = Record<string, ProjectAgentModelOverride>;

export interface ProjectAgentHeartbeatMeta {
  lastRunAt?: string;
  lastSummary?: string;
  suggestedActions?: string[];
  lastMemoryUpdateAt?: string;
  lastWorkingUpdateAt?: string;
}

export interface ProjectAgentProfile {
  id: number;
  projectId: number;
  role: AgentRole;
  displayName: string;
  emoji: string | null;
  avatarUrl: string | null;
  shortDescription: string | null;
  mission: string | null;
  isEnabled: boolean;
  fileBundle: ProjectAgentFileBundle;
  knowledgeParts: AgentKnowledgePart[];
  skillIds: number[];
  modelOverrides: ProjectAgentModelOverrides;
  heartbeatMeta: ProjectAgentHeartbeatMeta;
  createdById: string | null;
  updatedById: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertProjectAgentProfileInput {
  projectId: number;
  role: AgentRole;
  displayName?: string;
  emoji?: string | null;
  avatarUrl?: string | null;
  shortDescription?: string | null;
  mission?: string | null;
  isEnabled?: boolean;
  fileBundle?: Partial<ProjectAgentFileBundle>;
  knowledgeParts?: AgentKnowledgePart[];
  skillIds?: number[];
  modelOverrides?: ProjectAgentModelOverrides;
  heartbeatMeta?: ProjectAgentHeartbeatMeta;
  userId?: string | null;
}

export interface ProjectAgentLaneProfile {
  id: number;
  projectId: number;
  role: AgentRole;
  laneKey: AgentLaneKey;
  displayName: string;
  emoji: string | null;
  avatarUrl: string | null;
  shortDescription: string | null;
  mission: string | null;
  isEnabled: boolean;
  fileBundle: ProjectAgentFileBundle;
  knowledgeParts: AgentKnowledgePart[];
  skillIds: number[];
  modelOverrides: ProjectAgentModelOverrides;
  heartbeatMeta: ProjectAgentHeartbeatMeta;
  createdById: string | null;
  updatedById: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertProjectAgentLaneProfileInput {
  projectId: number;
  role: AgentRole;
  laneKey: AgentLaneKey;
  displayName?: string;
  emoji?: string | null;
  avatarUrl?: string | null;
  shortDescription?: string | null;
  mission?: string | null;
  isEnabled?: boolean;
  fileBundle?: Partial<ProjectAgentFileBundle>;
  knowledgeParts?: AgentKnowledgePart[];
  skillIds?: number[];
  modelOverrides?: ProjectAgentModelOverrides;
  heartbeatMeta?: ProjectAgentHeartbeatMeta;
  userId?: string | null;
}

export interface HeartbeatRoleResult {
  role: AgentRole;
  summary: string;
  suggestedActions: string[];
  profileUpdated: boolean;
}

export interface HeartbeatRunResult {
  projectId: number;
  runAt: string;
  roleResults: HeartbeatRoleResult[];
  projectSummary: string;
  suggestedActions: string[];
}
