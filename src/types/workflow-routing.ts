import type { AgentLaneKey } from '@/types/agent-runtime';
import type { ContentFormat } from '@/types/document';

export const ROUTABLE_WORKFLOW_STAGES = [
  'research',
  'seo_intel_review',
  'outline_build',
  'writing',
  'editing',
  'final_review',
] as const;

export type RoutableWorkflowStage = (typeof ROUTABLE_WORKFLOW_STAGES)[number];

export interface WorkflowStageRoute {
  stageSlots: Record<RoutableWorkflowStage, string>;
  stageEnabled: Record<RoutableWorkflowStage, boolean>;
  laneKey: AgentLaneKey;
}

export interface WorkflowStagePlanOwner {
  stage: RoutableWorkflowStage;
  slotKey: string;
  enabled: boolean;
  laneKey: AgentLaneKey;
  agentId?: string | null;
  agentName?: string | null;
  agentRole?: string | null;
}

export interface WorkflowStagePlanSnapshot {
  projectId: number;
  contentFormat: ContentFormat;
  laneKey: AgentLaneKey;
  owners: Record<RoutableWorkflowStage, WorkflowStagePlanOwner>;
  createdAt: number;
}
