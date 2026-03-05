import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { userCanAccessProject } from '@/lib/access';
import { logAlertEvent, logAuditEvent } from '@/lib/observability';
import { runProjectHeartbeat } from '@/lib/agents/project-agent-profiles';
import { FIXED_AGENT_ROLES, type AgentRole } from '@/types/agent-profile';

function parseProjectId(value: unknown): number | null {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseRoleFilter(value: unknown): AgentRole[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const roles = value
    .map((item) => String(item ?? '').trim())
    .filter((item): item is AgentRole => FIXED_AGENT_ROLES.includes(item as AgentRole));
  if (roles.length === 0) return undefined;
  return Array.from(new Set(roles));
}

export async function POST(req: NextRequest) {
  const auth = await requireRole('super_admin');
  if (auth.error) return auth.error;

  try {
    const body = await req.json();
    const projectId = parseProjectId(body.projectId);
    if (!projectId) {
      return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
    }
    if (!(await userCanAccessProject(auth.user, projectId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const roles = parseRoleFilter(body.roles);
    const result = await runProjectHeartbeat({
      projectId,
      actorUserId: auth.user.id,
      actorName: auth.user.name || auth.user.email,
      roles,
    });

    await logAuditEvent({
      userId: auth.user.id,
      action: 'admin.agent_heartbeat.run',
      resourceType: 'project',
      resourceId: projectId,
      projectId,
      metadata: {
        roles: roles ?? null,
        suggestions: result.suggestedActions,
      },
    });

    return NextResponse.json(result);
  } catch (error) {
    await logAlertEvent({
      source: 'admin',
      eventType: 'agent_heartbeat_failed',
      severity: 'error',
      message: 'Project agent heartbeat failed.',
      metadata: { error: error instanceof Error ? error.message : 'Unknown error' },
    });
    console.error('Admin heartbeat POST failed:', error);
    return NextResponse.json({ error: 'Failed to run heartbeat' }, { status: 500 });
  }
}

