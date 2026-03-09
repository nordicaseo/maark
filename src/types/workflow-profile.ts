import type { AIAction } from '@/types/ai';
import type { ContentFormat } from '@/types/document';
import type { RoutableWorkflowStage } from '@/types/workflow-routing';

export const WORKFLOW_PROFILE_STAGE_CATALOG = [
  'research',
  'seo_intel_review',
  'outline_build',
  'writing',
  'editing',
  'final_review',
] as const;

export type WorkflowProfileStage = (typeof WORKFLOW_PROFILE_STAGE_CATALOG)[number];

export interface WorkflowProfileConfig {
  id: number;
  key: string;
  name: string;
  description: string | null;
  stageSequence: WorkflowProfileStage[];
  stageEnabled: Record<WorkflowProfileStage, boolean>;
  stageActions: Record<WorkflowProfileStage, AIAction>;
  stageGuidance: Partial<Record<WorkflowProfileStage, string>>;
  isSystem: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowProfileAssignment {
  id: number;
  scope: 'global' | 'project';
  scopeKey: string;
  projectId: number | null;
  contentFormat: ContentFormat;
  profileKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface ResolvedWorkflowProfilePolicy {
  key: string;
  name: string;
  source: 'project' | 'global' | 'fallback';
  stageSequence: WorkflowProfileStage[];
  stageEnabled: Record<WorkflowProfileStage, boolean>;
  stageActions: Record<WorkflowProfileStage, AIAction>;
  stageGuidance: Partial<Record<WorkflowProfileStage, string>>;
}

export function isWorkflowProfileStage(value: unknown): value is WorkflowProfileStage {
  return (
    typeof value === 'string' &&
    (WORKFLOW_PROFILE_STAGE_CATALOG as readonly string[]).includes(value)
  );
}

export function workflowProfileStageToRoutableStage(
  stage: WorkflowProfileStage
): RoutableWorkflowStage {
  return stage as RoutableWorkflowStage;
}
