import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/db/index';
import { projects, projectMembers, skills, documents } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { dbNow } from '@/db/utils';
import { getAuthUser, requireRole } from '@/lib/auth';
import { userCanAccessProject } from '@/lib/access';
import {
  buildRoleCounts,
  parseProjectRuntimeSettings,
  syncProjectDedicatedAgentPool,
} from '@/lib/agents/runtime-agent-pools';
import type { AgentRoleCounts, AgentStaffingTemplate } from '@/types/agent-runtime';

function normalizeStaffingTemplate(input: unknown): AgentStaffingTemplate {
  const value = String(input ?? '')
    .trim()
    .toLowerCase();
  if (value === 'small' || value === 'standard' || value === 'premium') return value;
  return 'small';
}

function parseAgentRoleCounts(input: unknown): AgentRoleCounts {
  if (!input || typeof input !== 'object') return {};
  const source = input as Record<string, unknown>;
  const out: AgentRoleCounts = {};
  for (const role of [
    'researcher',
    'outliner',
    'writer',
    'seo-reviewer',
    'project-manager',
    'seo',
    'content',
    'lead',
  ] as const) {
    const raw = source[role];
    if (raw === undefined || raw === null) continue;
    out[role] = Math.max(1, Math.min(10, Number.parseInt(String(raw), 10) || 1));
  }
  return out;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureDb();
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const projectId = parseInt(id, 10);
  if (!(await userCanAccessProject(user, projectId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId));

    if (!project) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json(project);
  } catch (error) {
    console.error('Error fetching project:', error);
    return NextResponse.json({ error: 'Failed to fetch project' }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureDb();
  const auth = await requireRole('admin');
  if (auth.error) return auth.error;
  const { id } = await params;
  const projectId = parseInt(id, 10);
  if (!(await userCanAccessProject(auth.user, projectId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const [currentProject] = await db
      .select({
        settings: projects.settings,
      })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (!currentProject) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const updateData: Record<string, unknown> = { updatedAt: dbNow() };
    if (body.name !== undefined) updateData.name = body.name;
    if (body.description !== undefined) updateData.description = body.description;
    if (body.defaultContentFormat !== undefined) updateData.defaultContentFormat = body.defaultContentFormat;
    if (body.brandVoice !== undefined) updateData.brandVoice = body.brandVoice;
    if (body.settings !== undefined) updateData.settings = body.settings;

    let runtimeSync:
      | {
          template: AgentStaffingTemplate;
          roleCounts: Record<string, number>;
          created: number;
          updated: number;
        }
      | null = null;
    const hasRuntimeOverride =
      body.agentStaffingTemplate !== undefined || body.agentRoleCounts !== undefined;
    if (hasRuntimeOverride) {
      const baseSettings =
        updateData.settings && typeof updateData.settings === 'object'
          ? (updateData.settings as Record<string, unknown>)
          : currentProject.settings && typeof currentProject.settings === 'object'
            ? (currentProject.settings as Record<string, unknown>)
            : {};
      const runtime = parseProjectRuntimeSettings(baseSettings);
      const template = normalizeStaffingTemplate(
        body.agentStaffingTemplate ?? runtime.staffingTemplate
      );
      const roleCounts = buildRoleCounts(
        template,
        Object.keys(parseAgentRoleCounts(body.agentRoleCounts)).length > 0
          ? parseAgentRoleCounts(body.agentRoleCounts)
          : runtime.roleCounts
      );
      updateData.settings = {
        ...baseSettings,
        agentRuntime: {
          staffingTemplate: template,
          roleCounts,
          strictIsolation: true,
        },
      };

      const synced = await syncProjectDedicatedAgentPool({
        projectId,
        template,
        roleCounts,
      });
      runtimeSync = {
        template,
        roleCounts,
        created: synced.created,
        updated: synced.updated,
      };
    }

    const [project] = await db
      .update(projects)
      .set(updateData)
      .where(eq(projects.id, projectId))
      .returning();

    if (!project) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json({
      ...project,
      runtimeSync,
    });
  } catch (error) {
    console.error('Error updating project:', error);
    return NextResponse.json({ error: 'Failed to update project' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureDb();

  const auth = await requireRole('admin');
  if (auth.error) return auth.error;

  const { id } = await params;
  const projectId = parseInt(id, 10);
  if (!(await userCanAccessProject(auth.user, projectId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    // Cascade: delete project_members and skills, set null on documents
    await db.delete(projectMembers).where(eq(projectMembers.projectId, projectId));
    await db.delete(skills).where(eq(skills.projectId, projectId));
    await db
      .update(documents)
      .set({ projectId: null })
      .where(eq(documents.projectId, projectId));
    await db.delete(projects).where(eq(projects.id, projectId));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting project:', error);
    return NextResponse.json({ error: 'Failed to delete project' }, { status: 500 });
  }
}
