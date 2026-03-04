import type { DocumentStatus } from '@/types/document';

// ── Task status type (matches Convex schema) ──────────────────────────

export type TaskStatus =
  | 'BACKLOG'
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'IN_REVIEW'
  | 'ACCEPTED'
  | 'COMPLETED';

// ── Status mapping: Document → Task ──────────────────────────────────

const DOC_TO_TASK: Record<DocumentStatus, TaskStatus> = {
  draft: 'BACKLOG',
  in_progress: 'IN_PROGRESS',
  review: 'IN_REVIEW',
  accepted: 'ACCEPTED',
  publish: 'COMPLETED',
  live: 'COMPLETED',
};

// ── Status mapping: Task → Document ──────────────────────────────────

const TASK_TO_DOC: Record<TaskStatus, DocumentStatus> = {
  BACKLOG: 'draft',
  PENDING: 'draft',
  IN_PROGRESS: 'in_progress',
  IN_REVIEW: 'review',
  ACCEPTED: 'accepted',
  COMPLETED: 'publish',
};

// ── Mapping functions ────────────────────────────────────────────────

export function documentStatusToTaskStatus(
  docStatus: DocumentStatus
): TaskStatus {
  return DOC_TO_TASK[docStatus] ?? 'BACKLOG';
}

export function taskStatusToDocumentStatus(
  taskStatus: string
): DocumentStatus {
  return TASK_TO_DOC[taskStatus as TaskStatus] ?? 'draft';
}

// ── Sync-source flag (prevents infinite loops) ──────────────────────

export const SYNC_SOURCE_KEY = '_syncSource';
export const SYNC_SOURCE_CONVEX = 'convex';
