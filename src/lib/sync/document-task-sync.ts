import type { DocumentStatus } from '@/types/document';
import {
  DOCUMENT_TO_TASK_STATUS,
  TASK_TO_DOCUMENT_STATUS,
  type TaskStatus,
} from '@/lib/content-workflow-taxonomy';

// ── Task status type (matches Convex schema) ──────────────────────────

export type { TaskStatus } from '@/lib/content-workflow-taxonomy';

// ── Status mapping: Document → Task ──────────────────────────────────

const DOC_TO_TASK: Record<DocumentStatus, TaskStatus> = DOCUMENT_TO_TASK_STATUS;

// ── Status mapping: Task → Document ──────────────────────────────────

const TASK_TO_DOC: Record<TaskStatus, DocumentStatus> = TASK_TO_DOCUMENT_STATUS;

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
