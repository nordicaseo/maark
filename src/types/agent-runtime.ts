import type { AgentRole } from './agent-profile';

export const AGENT_STAFFING_TEMPLATES = ['small', 'standard', 'premium'] as const;

export type AgentStaffingTemplate = (typeof AGENT_STAFFING_TEMPLATES)[number];

export type AgentRoleCounts = Partial<Record<AgentRole, number>>;

export interface ProjectAgentRuntimeSettings {
  staffingTemplate: AgentStaffingTemplate;
  roleCounts: AgentRoleCounts;
  strictIsolation: boolean;
}

export interface ProjectAgentPoolHealth {
  projectId: number;
  totalAgents: number;
  totalDedicated: number;
  availableWriters: number;
  queuedWriting: number;
  staleLocks: number;
  byRole: Array<{
    role: AgentRole;
    total: number;
    online: number;
    idle: number;
    working: number;
    offline: number;
  }>;
  writerRows: Array<{
    id: string;
    name: string;
    status: 'ONLINE' | 'IDLE' | 'WORKING' | 'OFFLINE';
    lockHealth: 'healthy' | 'stale' | 'unknown_task' | 'idle' | 'offline';
    currentTaskId: string | null;
  }>;
}

export type ProjectBootstrapStage =
  | 'seeding_agents'
  | 'creating_mission_control'
  | 'fetching_pages'
  | 'connect_gsc';

export interface ProjectBootstrapStageState {
  stage: ProjectBootstrapStage;
  label: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  message?: string | null;
  updatedAt?: string | null;
}
