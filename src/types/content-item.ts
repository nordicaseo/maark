import type { DocumentStatus } from '@/types/document';
import type { WorkflowRuntimeState } from '@/lib/content-workflow-taxonomy';

export interface ContentItemCard {
  id: number;
  projectId: number | null;
  authorId: string | null;
  authorName: string | null;
  title: string;
  status: DocumentStatus;
  contentType: string;
  targetKeyword: string | null;
  wordCount: number;
  aiDetectionScore: number | null;
  semanticScore: number | null;
  contentQualityScore: number | null;
  updatedAt: string;
  createdAt: string;
  task: {
    id: string;
    status: string;
    workflowTemplateKey?: string;
    workflowCurrentStageKey?: string;
    workflowStageStatus?: string;
    workflowLastEventText?: string;
    workflowLastEventAt?: number;
    deliverables?: Array<{
      id: string;
      type: string;
      title: string;
      url?: string;
      createdAt: number;
    }>;
    assigneeId?: string;
    assignedAgentId?: string;
    updatedAt?: number;
  } | null;
  workflowRuntimeState: WorkflowRuntimeState | null;
  workflowStageLabel: string | null;
  deliverableReadiness: {
    researchReady: boolean;
    outlineReady: boolean;
    prewriteReady: boolean;
    writingReady: boolean;
  };
}

