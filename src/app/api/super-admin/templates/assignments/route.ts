import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { userCanAccessProject } from '@/lib/access';
import { CONTENT_FORMAT_LABELS, type ContentFormat } from '@/types/document';
import {
  listTemplateAssignments,
  upsertTemplateAssignment,
} from '@/lib/workflow/content-templates';
import { logAlertEvent, logAuditEvent } from '@/lib/observability';

function parseOptionalProjectId(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function isContentFormat(value: unknown): value is ContentFormat {
  if (typeof value !== 'string') return false;
  return value in CONTENT_FORMAT_LABELS;
}

export async function GET(req: NextRequest) {
  const auth = await requireRole('super_admin');
  if (auth.error) return auth.error;

  try {
    const projectId = parseOptionalProjectId(req.nextUrl.searchParams.get('projectId'));
    if (projectId !== null && !(await userCanAccessProject(auth.user, projectId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const assignments = await listTemplateAssignments(projectId);
    return NextResponse.json(assignments);
  } catch (error) {
    await logAlertEvent({
      source: 'super_admin',
      eventType: 'template_assignments_list_failed',
      severity: 'error',
      message: 'Failed to list template assignments.',
      metadata: { error: error instanceof Error ? error.message : 'Unknown error' },
    });
    return NextResponse.json({ error: 'Failed to list assignments' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const auth = await requireRole('super_admin');
  if (auth.error) return auth.error;

  try {
    const body = await req.json();
    const projectId = parseOptionalProjectId(body.projectId);
    if (projectId !== null && !(await userCanAccessProject(auth.user, projectId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const contentFormat = body.contentFormat;
    const templateKey = String(body.templateKey || '').trim();

    if (!isContentFormat(contentFormat) || !templateKey) {
      return NextResponse.json(
        { error: 'contentFormat and templateKey are required' },
        { status: 400 }
      );
    }

    const assignment = await upsertTemplateAssignment({
      projectId,
      contentFormat,
      templateKey,
    });

    await logAuditEvent({
      userId: auth.user.id,
      action: 'super_admin.template_assignment.upsert',
      resourceType: 'content_template_assignment',
      resourceId: assignment.id,
      projectId,
      severity: 'warning',
      metadata: {
        contentFormat: assignment.contentFormat,
        templateKey: assignment.templateKey,
        scope: assignment.scope,
      },
    });

    return NextResponse.json(assignment);
  } catch (error) {
    await logAlertEvent({
      source: 'super_admin',
      eventType: 'template_assignment_upsert_failed',
      severity: 'error',
      message: 'Failed to save template assignment.',
      metadata: { error: error instanceof Error ? error.message : 'Unknown error' },
    });
    return NextResponse.json({ error: 'Failed to save assignment' }, { status: 500 });
  }
}

