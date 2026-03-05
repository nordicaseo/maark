import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { userCanAccessProject, userCanAccessSkill } from '@/lib/access';
import { logAlertEvent, logAuditEvent } from '@/lib/observability';
import {
  seedProjectAgentProfiles,
  upsertProjectAgentProfile,
} from '@/lib/agents/project-agent-profiles';
import { AGENT_FILE_KEYS, FIXED_AGENT_ROLES, type AgentRole } from '@/types/agent-profile';

function parseProjectId(value: unknown): number | null {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function isAgentRole(value: unknown): value is AgentRole {
  return typeof value === 'string' && FIXED_AGENT_ROLES.includes(value as AgentRole);
}

function sanitizeFileBundle(
  input: unknown
): Record<string, string> | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const out: Record<string, string> = {};
  for (const key of AGENT_FILE_KEYS) {
    const raw = (input as Record<string, unknown>)[key];
    if (typeof raw === 'string') out[key] = raw;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function sanitizeSkillIds(input: unknown): number[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const unique = new Set<number>();
  for (const value of input) {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) unique.add(Math.trunc(n));
  }
  return Array.from(unique);
}

function sanitizeModelOverrides(input: unknown) {
  if (!input || typeof input !== 'object') return undefined;
  const out: Record<string, { provider?: string; modelId?: string; temperature?: number }> = {};
  for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const provider = typeof r.provider === 'string' ? r.provider.trim() : undefined;
    const modelId = typeof r.modelId === 'string' ? r.modelId.trim() : undefined;
    const temperature =
      typeof r.temperature === 'number' && Number.isFinite(r.temperature)
        ? r.temperature
        : undefined;
    out[key] = {
      ...(provider ? { provider } : {}),
      ...(modelId ? { modelId } : {}),
      ...(temperature !== undefined ? { temperature } : {}),
    };
  }
  return out;
}

export async function GET(req: NextRequest) {
  const auth = await requireRole('admin');
  if (auth.error) return auth.error;

  try {
    const projectId = parseProjectId(req.nextUrl.searchParams.get('projectId'));
    if (!projectId) {
      return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
    }

    if (!(await userCanAccessProject(auth.user, projectId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { seededRoles, profiles } = await seedProjectAgentProfiles(projectId, auth.user.id);
    return NextResponse.json({
      projectId,
      seededRoles,
      profiles,
    });
  } catch (error) {
    await logAlertEvent({
      source: 'admin',
      eventType: 'agent_profiles_list_failed',
      severity: 'error',
      message: 'Failed to list project agent profiles.',
      metadata: { error: error instanceof Error ? error.message : 'Unknown error' },
    });
    console.error('Admin agents GET failed:', error);
    return NextResponse.json({ error: 'Failed to load agent profiles' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const auth = await requireRole('admin');
  if (auth.error) return auth.error;

  try {
    const body = await req.json();
    const projectId = parseProjectId(body.projectId);
    if (!projectId) {
      return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
    }
    if (!isAgentRole(body.role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
    }
    if (!(await userCanAccessProject(auth.user, projectId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const skillIds = sanitizeSkillIds(body.skillIds);
    if (skillIds && skillIds.length > 0) {
      for (const skillId of skillIds) {
        if (!(await userCanAccessSkill(auth.user, skillId))) {
          return NextResponse.json(
            { error: `Forbidden skillId ${skillId}` },
            { status: 403 }
          );
        }
      }
    }

    const profile = await upsertProjectAgentProfile({
      projectId,
      role: body.role,
      displayName: typeof body.displayName === 'string' ? body.displayName : undefined,
      emoji: typeof body.emoji === 'string' ? body.emoji : undefined,
      mission: typeof body.mission === 'string' ? body.mission : undefined,
      isEnabled: typeof body.isEnabled === 'boolean' ? body.isEnabled : undefined,
      fileBundle: sanitizeFileBundle(body.fileBundle),
      skillIds,
      modelOverrides: sanitizeModelOverrides(body.modelOverrides),
      heartbeatMeta:
        body.heartbeatMeta && typeof body.heartbeatMeta === 'object'
          ? body.heartbeatMeta
          : undefined,
      userId: auth.user.id,
    });

    await logAuditEvent({
      userId: auth.user.id,
      action: 'admin.agent_profile.update',
      resourceType: 'project_agent_profile',
      resourceId: `${projectId}:${body.role}`,
      projectId,
      metadata: {
        role: body.role,
        isEnabled: profile.isEnabled,
        mappedSkillIds: profile.skillIds,
      },
    });

    return NextResponse.json(profile);
  } catch (error) {
    await logAlertEvent({
      source: 'admin',
      eventType: 'agent_profile_update_failed',
      severity: 'error',
      message: 'Failed to update project agent profile.',
      metadata: { error: error instanceof Error ? error.message : 'Unknown error' },
    });
    console.error('Admin agents PUT failed:', error);
    return NextResponse.json({ error: 'Failed to update agent profile' }, { status: 500 });
  }
}
