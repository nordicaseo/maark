import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { userCanAccessProject } from '@/lib/access';
import type { AIAction } from '@/types/ai';
import type { WorkflowProfileStage } from '@/types/workflow-profile';
import {
  isWorkflowProfileStage,
  WORKFLOW_PROFILE_STAGE_CATALOG,
} from '@/types/workflow-profile';
import {
  listWorkflowProfileAssignments,
  listWorkflowProfileConfigs,
  upsertWorkflowProfileConfig,
} from '@/lib/workflow/workflow-profiles';
import { logAlertEvent, logAuditEvent } from '@/lib/observability';

function parseOptionalProjectId(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function isAiAction(value: unknown): value is AIAction {
  return (
    typeof value === 'string' &&
    [
      'writing',
      'rewriting',
      'formatting',
      'skill_generation',
      'comment_processing',
      'research',
      'workflow_research',
      'workflow_serp',
      'workflow_outline',
      'workflow_prewrite',
      'workflow_writing',
      'workflow_editing',
      'workflow_final_review',
      'workflow_pm',
    ].includes(value)
  );
}

function sanitizeStageSequence(value: unknown): WorkflowProfileStage[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: WorkflowProfileStage[] = [];
  for (const item of value) {
    if (!isWorkflowProfileStage(item)) continue;
    if (!out.includes(item)) out.push(item);
  }
  return out.length > 0 ? out : undefined;
}

function sanitizeStageEnabled(
  value: unknown
): Partial<Record<WorkflowProfileStage, boolean>> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const source = value as Record<string, unknown>;
  const out: Partial<Record<WorkflowProfileStage, boolean>> = {};
  for (const stage of WORKFLOW_PROFILE_STAGE_CATALOG) {
    if (source[stage] === undefined) continue;
    out[stage] = source[stage] === true || String(source[stage]).toLowerCase() === 'true';
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function sanitizeStageActions(
  value: unknown
): Partial<Record<WorkflowProfileStage, AIAction>> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const source = value as Record<string, unknown>;
  const out: Partial<Record<WorkflowProfileStage, AIAction>> = {};
  for (const stage of WORKFLOW_PROFILE_STAGE_CATALOG) {
    const raw = source[stage];
    if (!isAiAction(raw)) continue;
    out[stage] = raw;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function sanitizeStageGuidance(
  value: unknown
): Partial<Record<WorkflowProfileStage, string>> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const source = value as Record<string, unknown>;
  const out: Partial<Record<WorkflowProfileStage, string>> = {};
  for (const stage of WORKFLOW_PROFILE_STAGE_CATALOG) {
    const raw = source[stage];
    if (typeof raw !== 'string' || !raw.trim()) continue;
    out[stage] = raw.trim();
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export async function GET(req: NextRequest) {
  const auth = await requireRole('super_admin');
  if (auth.error) return auth.error;

  try {
    const projectId = parseOptionalProjectId(req.nextUrl.searchParams.get('projectId'));
    if (projectId !== null && !(await userCanAccessProject(auth.user, projectId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const [profiles, assignments] = await Promise.all([
      listWorkflowProfileConfigs(),
      listWorkflowProfileAssignments(projectId),
    ]);

    return NextResponse.json({ profiles, assignments });
  } catch (error) {
    await logAlertEvent({
      source: 'super_admin',
      eventType: 'workflow_profiles_list_failed',
      severity: 'error',
      message: 'Failed to list workflow profiles.',
      metadata: { error: error instanceof Error ? error.message : 'Unknown error' },
    });
    return NextResponse.json({ error: 'Failed to load workflow profiles' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const auth = await requireRole('super_admin');
  if (auth.error) return auth.error;

  try {
    const body = await req.json();
    const key = String(body.key || '').trim();
    const name = String(body.name || '').trim();
    if (!key || !name) {
      return NextResponse.json(
        { error: 'key and name are required' },
        { status: 400 }
      );
    }

    const profile = await upsertWorkflowProfileConfig({
      key,
      name,
      description: typeof body.description === 'string' ? body.description : null,
      stageSequence: sanitizeStageSequence(body.stageSequence),
      stageEnabled: sanitizeStageEnabled(body.stageEnabled),
      stageActions: sanitizeStageActions(body.stageActions),
      stageGuidance: sanitizeStageGuidance(body.stageGuidance),
      isSystem: body.isSystem === true,
      isActive: body.isActive !== false,
    });

    await logAuditEvent({
      userId: auth.user.id,
      action: 'super_admin.workflow_profile.upsert',
      resourceType: 'workflow_profile',
      resourceId: profile.id,
      severity: 'warning',
      metadata: {
        key: profile.key,
        stageSequence: profile.stageSequence,
      },
    });

    return NextResponse.json(profile);
  } catch (error) {
    await logAlertEvent({
      source: 'super_admin',
      eventType: 'workflow_profile_upsert_failed',
      severity: 'error',
      message: 'Failed to save workflow profile.',
      metadata: { error: error instanceof Error ? error.message : 'Unknown error' },
    });
    return NextResponse.json({ error: 'Failed to save workflow profile' }, { status: 500 });
  }
}
