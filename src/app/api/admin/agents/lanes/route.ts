import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { userCanAccessProject } from '@/lib/access';
import { logAlertEvent, logAuditEvent } from '@/lib/observability';
import {
  listProjectAgentLaneProfiles,
  seedProjectAgentLaneProfiles,
  upsertProjectAgentLaneProfile,
} from '@/lib/agents/project-agent-profiles';
import {
  AGENT_FILE_KEYS,
  AGENT_KNOWLEDGE_PART_TYPES,
  type AgentRole,
} from '@/types/agent-profile';
import { AGENT_WRITER_LANES, type AgentLaneKey } from '@/types/agent-runtime';

function parseProjectId(value: unknown): number | null {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function isAgentRole(value: unknown): value is AgentRole {
  return value === 'writer';
}

function isLaneKey(value: unknown): value is AgentLaneKey {
  return typeof value === 'string' && AGENT_WRITER_LANES.includes(value as AgentLaneKey);
}

function sanitizeFileBundle(input: unknown): Record<string, string> | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const out: Record<string, string> = {};
  for (const key of AGENT_FILE_KEYS) {
    const raw = (input as Record<string, unknown>)[key];
    if (typeof raw === 'string') out[key] = raw;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function sanitizeKnowledgeParts(input: unknown) {
  if (!Array.isArray(input)) return undefined;
  const out: Array<{
    id: string;
    partType: (typeof AGENT_KNOWLEDGE_PART_TYPES)[number];
    label: string;
    content: string;
    sortOrder: number;
  }> = [];
  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const rawPartType = String(row.partType || '').trim();
    const partType = AGENT_KNOWLEDGE_PART_TYPES.includes(
      rawPartType as (typeof AGENT_KNOWLEDGE_PART_TYPES)[number]
    )
      ? (rawPartType as (typeof AGENT_KNOWLEDGE_PART_TYPES)[number])
      : 'custom';
    const content = typeof row.content === 'string' ? row.content.trim() : '';
    if (!content) continue;
    const label =
      typeof row.label === 'string' && row.label.trim()
        ? row.label.trim()
        : partType.replace(/_/g, ' ');
    const id =
      typeof row.id === 'string' && row.id.trim() ? row.id.trim() : `${partType}:${out.length}`;
    const sortOrder = Number.isFinite(Number(row.sortOrder))
      ? Math.max(0, Math.trunc(Number(row.sortOrder)))
      : out.length;
    out.push({ id, partType, label, content, sortOrder });
  }
  return out;
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

function sanitizeAvatarUrl(input: unknown): string | undefined {
  if (typeof input !== 'string') return undefined;
  const value = input.trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value) || value.startsWith('/')) return value;
  return undefined;
}

export async function GET(req: NextRequest) {
  const auth = await requireRole('super_admin');
  if (auth.error) return auth.error;

  try {
    const projectId = parseProjectId(req.nextUrl.searchParams.get('projectId'));
    if (!projectId) {
      return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
    }
    if (!(await userCanAccessProject(auth.user, projectId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const seeded = await seedProjectAgentLaneProfiles(projectId, auth.user.id);
    const profiles = await listProjectAgentLaneProfiles(projectId, 'writer');
    return NextResponse.json({
      projectId,
      seededLaneProfiles: seeded.seededLaneProfiles,
      profiles,
    });
  } catch (error) {
    await logAlertEvent({
      source: 'admin',
      eventType: 'agent_lane_profiles_list_failed',
      severity: 'error',
      message: 'Failed to list project lane agent profiles.',
      metadata: { error: error instanceof Error ? error.message : 'Unknown error' },
    });
    return NextResponse.json({ error: 'Failed to load lane profiles' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const auth = await requireRole('super_admin');
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
    if (!isLaneKey(body.laneKey)) {
      return NextResponse.json({ error: 'Invalid laneKey' }, { status: 400 });
    }
    if (!(await userCanAccessProject(auth.user, projectId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const profile = await upsertProjectAgentLaneProfile({
      projectId,
      role: body.role,
      laneKey: body.laneKey,
      displayName: typeof body.displayName === 'string' ? body.displayName : undefined,
      emoji: typeof body.emoji === 'string' ? body.emoji : undefined,
      avatarUrl: sanitizeAvatarUrl(body.avatarUrl),
      shortDescription:
        typeof body.shortDescription === 'string' ? body.shortDescription : undefined,
      mission: typeof body.mission === 'string' ? body.mission : undefined,
      isEnabled: typeof body.isEnabled === 'boolean' ? body.isEnabled : undefined,
      fileBundle: sanitizeFileBundle(body.fileBundle),
      knowledgeParts: sanitizeKnowledgeParts(body.knowledgeParts),
      skillIds: [],
      modelOverrides: sanitizeModelOverrides(body.modelOverrides),
      heartbeatMeta:
        body.heartbeatMeta && typeof body.heartbeatMeta === 'object'
          ? body.heartbeatMeta
          : undefined,
      userId: auth.user.id,
    });

    await logAuditEvent({
      userId: auth.user.id,
      action: 'admin.agent_lane_profile.update',
      resourceType: 'project_agent_lane_profile',
      resourceId: `${projectId}:${body.role}:${body.laneKey}`,
      projectId,
      metadata: {
        role: body.role,
        laneKey: body.laneKey,
        isEnabled: profile.isEnabled,
        knowledgeParts: profile.knowledgeParts.length,
      },
    });

    return NextResponse.json(profile);
  } catch (error) {
    await logAlertEvent({
      source: 'admin',
      eventType: 'agent_lane_profile_update_failed',
      severity: 'error',
      message: 'Failed to update lane profile.',
      metadata: { error: error instanceof Error ? error.message : 'Unknown error' },
    });
    return NextResponse.json({ error: 'Failed to update lane profile' }, { status: 500 });
  }
}
