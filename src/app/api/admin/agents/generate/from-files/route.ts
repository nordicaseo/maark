import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { requireRole } from '@/lib/auth';
import { userCanAccessProject } from '@/lib/access';
import { db, ensureDb } from '@/db';
import { projects } from '@/db/schema';
import { logAlertEvent, logAuditEvent } from '@/lib/observability';
import {
  upsertProjectAgentLaneProfile,
  upsertProjectAgentProfile,
} from '@/lib/agents/project-agent-profiles';
import { generateAgentKnowledgeProfile } from '@/lib/agents/knowledge-generation';
import { FIXED_AGENT_ROLES, type AgentRole } from '@/types/agent-profile';
import { AGENT_WRITER_LANES, type AgentLaneKey } from '@/types/agent-runtime';

function parseProjectId(value: unknown): number | null {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function isAgentRole(value: unknown): value is AgentRole {
  return typeof value === 'string' && FIXED_AGENT_ROLES.includes(value as AgentRole);
}

function isLaneKey(value: unknown): value is AgentLaneKey {
  return typeof value === 'string' && AGENT_WRITER_LANES.includes(value as AgentLaneKey);
}

export async function POST(req: NextRequest) {
  const auth = await requireRole('super_admin');
  if (auth.error) return auth.error;

  try {
    await ensureDb();
    const formData = await req.formData();
    const projectId = parseProjectId(formData.get('projectId'));
    const role = String(formData.get('role') || '').trim();
    const laneKeyRaw = String(formData.get('laneKey') || '').trim();
    const description = String(formData.get('description') || '').trim();
    const applyRaw = String(formData.get('apply') || 'true').trim().toLowerCase();
    const apply = applyRaw !== 'false' && applyRaw !== '0';
    const files = formData.getAll('files') as File[];

    if (!projectId) {
      return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
    }
    if (!(await userCanAccessProject(auth.user, projectId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (!isAgentRole(role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
    }
    const laneKey = isLaneKey(laneKeyRaw) ? laneKeyRaw : undefined;
    if (laneKey && role !== 'writer') {
      return NextResponse.json(
        { error: 'laneKey is only supported for writer role generation' },
        { status: 400 }
      );
    }
    if (files.length === 0) {
      return NextResponse.json({ error: 'At least one file is required' }, { status: 400 });
    }

    const sourceDocuments: Array<{ name: string; content: string }> = [];
    for (const file of files.slice(0, 12)) {
      const name = file.name.toLowerCase();
      if (
        !name.endsWith('.txt') &&
        !name.endsWith('.md') &&
        !name.endsWith('.markdown') &&
        !name.endsWith('.csv')
      ) {
        continue;
      }
      const content = (await file.text()).trim().slice(0, 12000);
      if (content.length < 40) continue;
      sourceDocuments.push({ name: file.name, content });
    }

    if (sourceDocuments.length === 0) {
      return NextResponse.json(
        { error: 'No supported text content found. Use .txt/.md/.csv files.' },
        { status: 400 }
      );
    }

    const [projectRow] = await db
      .select({ name: projects.name })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    const generated = await generateAgentKnowledgeProfile({
      projectName: projectRow?.name || `Project ${projectId}`,
      role,
      laneKey,
      description,
      sourceDocuments,
    });

    let profile: unknown = null;
    if (apply) {
      if (role === 'writer' && laneKey) {
        profile = await upsertProjectAgentLaneProfile({
          projectId,
          role,
          laneKey,
          displayName: generated.displayName,
          shortDescription: generated.shortDescription,
          mission: generated.mission,
          fileBundle: generated.fileBundle,
          knowledgeParts: generated.knowledgeParts,
          skillIds: [],
          userId: auth.user.id,
        });
      } else {
        profile = await upsertProjectAgentProfile({
          projectId,
          role,
          displayName: generated.displayName,
          shortDescription: generated.shortDescription,
          mission: generated.mission,
          fileBundle: generated.fileBundle,
          knowledgeParts: generated.knowledgeParts,
          skillIds: [],
          userId: auth.user.id,
        });
      }
    }

    await logAuditEvent({
      userId: auth.user.id,
      action: 'admin.agent_profile.generate_from_files',
      resourceType: 'project_agent_profile',
      resourceId: `${projectId}:${role}${laneKey ? `:${laneKey}` : ''}`,
      projectId,
      metadata: {
        role,
        laneKey: laneKey ?? null,
        fileCount: sourceDocuments.length,
        applied: apply,
        generatedKnowledgeParts: generated.knowledgeParts.length,
      },
    });

    return NextResponse.json({
      ok: true,
      projectId,
      role,
      laneKey: laneKey ?? null,
      generated,
      profile,
    });
  } catch (error) {
    await logAlertEvent({
      source: 'admin',
      eventType: 'agent_profile_generate_from_files_failed',
      severity: 'error',
      message: 'Failed to generate agent profile from files.',
      metadata: { error: error instanceof Error ? error.message : 'Unknown error' },
    });
    return NextResponse.json({ error: 'Failed to generate agent profile' }, { status: 500 });
  }
}
