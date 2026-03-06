import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { userCanAccessProject } from '@/lib/access';
import {
  listContentTemplateConfigs,
  listTemplateAssignments,
  upsertContentTemplateConfig,
} from '@/lib/workflow/content-templates';
import type { ContentFormat } from '@/types/document';
import { CONTENT_FORMAT_LABELS } from '@/types/document';
import { logAlertEvent, logAuditEvent } from '@/lib/observability';

function parseOptionalProjectId(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
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

    const [templates, assignments] = await Promise.all([
      listContentTemplateConfigs(),
      listTemplateAssignments(projectId),
    ]);

    return NextResponse.json({ templates, assignments });
  } catch (error) {
    await logAlertEvent({
      source: 'super_admin',
      eventType: 'templates_list_failed',
      severity: 'error',
      message: 'Failed to list content templates.',
      metadata: { error: error instanceof Error ? error.message : 'Unknown error' },
    });
    return NextResponse.json({ error: 'Failed to load templates' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const auth = await requireRole('super_admin');
  if (auth.error) return auth.error;

  try {
    const body = await req.json();
    const key = String(body.key || '').trim();
    const name = String(body.name || '').trim();
    const contentFormats = Array.isArray(body.contentFormats)
      ? (body.contentFormats as unknown[]).filter(isContentFormat)
      : [];

    if (!key || !name || contentFormats.length === 0) {
      return NextResponse.json(
        { error: 'key, name, and at least one valid contentFormat are required' },
        { status: 400 }
      );
    }

    const template = await upsertContentTemplateConfig({
      key,
      name,
      description: typeof body.description === 'string' ? body.description : null,
      contentFormats,
      structure: typeof body.structure === 'object' && body.structure ? body.structure : undefined,
      wordRange: typeof body.wordRange === 'object' && body.wordRange ? body.wordRange : undefined,
      outlineConstraints:
        typeof body.outlineConstraints === 'object' && body.outlineConstraints
          ? body.outlineConstraints
          : undefined,
      styleGuard: typeof body.styleGuard === 'object' && body.styleGuard ? body.styleGuard : undefined,
      isSystem: body.isSystem === true,
      isActive: body.isActive !== false,
    });

    await logAuditEvent({
      userId: auth.user.id,
      action: 'super_admin.template.upsert',
      resourceType: 'content_template',
      resourceId: template.id,
      severity: 'warning',
      metadata: {
        key: template.key,
        contentFormats: template.contentFormats,
      },
    });

    return NextResponse.json(template);
  } catch (error) {
    await logAlertEvent({
      source: 'super_admin',
      eventType: 'template_upsert_failed',
      severity: 'error',
      message: 'Failed to save content template.',
      metadata: { error: error instanceof Error ? error.message : 'Unknown error' },
    });
    return NextResponse.json({ error: 'Failed to save template' }, { status: 500 });
  }
}

