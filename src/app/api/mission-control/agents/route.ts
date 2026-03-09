import { NextRequest, NextResponse } from 'next/server';
import { api } from '../../../../../convex/_generated/api';
import { requireRole } from '@/lib/auth';
import { getRequestedProjectId, userCanAccessProject } from '@/lib/access';
import {
  listProjectAgentLaneProfiles,
  listProjectAgentProfiles,
  seedProjectAgentLaneProfiles,
  seedProjectAgentProfiles,
  synchronizeWriterLaneProfileNames,
} from '@/lib/agents/project-agent-profiles';
import { getConvexClient } from '@/lib/convex/server';
import { getProjectAgentPoolHealth } from '@/lib/agents/runtime-agent-pools';

function parseProjectId(value: unknown): number | null {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function isAgentLaneKey(value: unknown): value is 'blog' | 'collection' | 'product' | 'landing' {
  return value === 'blog' || value === 'collection' || value === 'product' || value === 'landing';
}

function parseWriterSlotKey(slotKey: string): { projectId: number; laneKey: 'blog' | 'collection' | 'product' | 'landing'; ordinal: number } | null {
  const match = /^p(\d+):writer:(blog|collection|product|landing):(\d+)$/.exec(String(slotKey || '').trim());
  if (!match) return null;
  return {
    projectId: Number.parseInt(match[1], 10),
    laneKey: match[2] as 'blog' | 'collection' | 'product' | 'landing',
    ordinal: Number.parseInt(match[3], 10),
  };
}

function isRoutableAssignment(assignmentHealth: unknown): boolean {
  if (!assignmentHealth || typeof assignmentHealth !== 'object') return true;
  return (assignmentHealth as Record<string, unknown>).routable !== false;
}

function extractTools(toolsMarkdown: string | null | undefined): string[] {
  const raw = String(toolsMarkdown || '').trim();
  if (!raw) return [];
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith('#'))
    .map((line) => line.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 8);
}

export async function GET(req: NextRequest) {
  const auth = await requireRole('client');
  if (auth.error) return auth.error;

  const queryProjectId = parseProjectId(req.nextUrl.searchParams.get('projectId'));
  const scopedProjectId = queryProjectId ?? getRequestedProjectId(req);
  if (!scopedProjectId) {
    return NextResponse.json({ projectId: null, profiles: [] });
  }

  if (!(await userCanAccessProject(auth.user, scopedProjectId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await seedProjectAgentProfiles(scopedProjectId, auth.user.id);
  await seedProjectAgentLaneProfiles(scopedProjectId, auth.user.id);
  await synchronizeWriterLaneProfileNames({
    projectId: scopedProjectId,
    userId: auth.user.id,
  });
  const profiles = await listProjectAgentProfiles(scopedProjectId);
  const laneProfiles = await listProjectAgentLaneProfiles(scopedProjectId, 'writer');
  const health = await getProjectAgentPoolHealth(scopedProjectId).catch(() => null);
  const convex = getConvexClient();

  const roleDisplayNameByRole = new Map(
    profiles
      .map((profile) => [profile.role.toLowerCase(), profile.displayName.trim()] as const)
      .filter((entry) => entry[1].length > 0)
  );
  const laneDisplayNameByLane = new Map(
    laneProfiles
      .map((profile) => [profile.laneKey.toLowerCase(), profile.displayName.trim()] as const)
      .filter((entry) => entry[1].length > 0)
  );
  const runtimeAgents = convex
    ? (
        (await convex.query(api.agents.list, {
          projectId: scopedProjectId,
          limit: 2000,
        })) as Array<{
          _id: string;
          name: string;
          role: string;
          status: string;
          slotKey?: string;
          laneKey?: string;
          currentTaskId?: string;
          projectId?: number;
          isDedicated?: boolean;
          specialization?: string;
          assignmentHealth?: Record<string, unknown>;
        }>
      )
        .filter((agent) => Number(agent.projectId) === scopedProjectId)
        .filter((agent) => agent.isDedicated !== false)
        .filter((agent) => isRoutableAssignment(agent.assignmentHealth))
        .filter((agent) => {
          const slotKey = String(agent.slotKey || '').trim();
          if (!slotKey || slotKey.includes(':auto:')) return false;
          return slotKey.startsWith(`p${scopedProjectId}:`);
        })
        .filter((agent) => {
          if (agent.role.toLowerCase() !== 'writer') return true;
          const laneKey = isAgentLaneKey(agent.laneKey) ? agent.laneKey : null;
          if (!laneKey) return false;
          const slotKey = String(agent.slotKey || '').trim();
          if (!slotKey || slotKey.includes(':auto:')) return false;
          const parsed = parseWriterSlotKey(slotKey);
          if (!parsed) return false;
          if (parsed.projectId !== scopedProjectId) return false;
          if (parsed.laneKey !== laneKey) return false;
          return parsed.ordinal === 1;
        })
        .map((agent) => {
          const role = agent.role.toLowerCase();
          const laneKey = isAgentLaneKey(agent.laneKey) ? agent.laneKey : null;
          const runtimeName = String(agent.name || '').trim();
          const profileFallback =
            role === 'writer' && laneKey
              ? laneDisplayNameByLane.get(laneKey) || roleDisplayNameByRole.get(role) || ''
              : roleDisplayNameByRole.get(role) || '';
          const displayName =
            runtimeName ||
            profileFallback ||
            String(agent.slotKey || '').trim() ||
            role;
          return {
            id: String(agent._id),
            name: displayName,
            role: role,
            status: String(agent.status || '').toUpperCase(),
            slotKey: String(agent.slotKey || ''),
            laneKey: laneKey,
            currentTaskId: agent.currentTaskId ? String(agent.currentTaskId) : null,
            specialization:
              typeof agent.specialization === 'string' ? agent.specialization : null,
          };
        })
        .sort((a, b) => {
          const statusOrder = ['WORKING', 'ONLINE', 'IDLE', 'OFFLINE'];
          const aStatus = statusOrder.indexOf(a.status);
          const bStatus = statusOrder.indexOf(b.status);
          if (aStatus !== bStatus) return aStatus - bStatus;
          const roleSort = a.role.localeCompare(b.role);
          if (roleSort !== 0) return roleSort;
          const nameSort = a.name.localeCompare(b.name);
          if (nameSort !== 0) return nameSort;
          return a.slotKey.localeCompare(b.slotKey);
        })
    : [];

  return NextResponse.json({
    projectId: scopedProjectId,
    health,
    runtimeAgents,
    profiles: profiles.map((profile) => ({
      role: profile.role,
      displayName: profile.displayName,
      emoji: profile.emoji,
      avatarUrl: profile.avatarUrl,
      shortDescription: profile.shortDescription,
      mission: profile.mission,
      tools: extractTools(profile.fileBundle?.TOOLS),
      updatedAt: profile.updatedAt,
    })),
    laneProfiles: laneProfiles.map((profile) => ({
      role: profile.role,
      laneKey: profile.laneKey,
      displayName: profile.displayName,
      emoji: profile.emoji,
      avatarUrl: profile.avatarUrl,
      shortDescription: profile.shortDescription,
      mission: profile.mission,
      tools: extractTools(profile.fileBundle?.TOOLS),
      updatedAt: profile.updatedAt,
    })),
  });
}
