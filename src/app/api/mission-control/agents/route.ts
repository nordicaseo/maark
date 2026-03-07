import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { getRequestedProjectId, userCanAccessProject } from '@/lib/access';
import {
  listProjectAgentProfiles,
  seedProjectAgentProfiles,
} from '@/lib/agents/project-agent-profiles';
import { getProjectAgentPoolHealth } from '@/lib/agents/runtime-agent-pools';

function parseProjectId(value: unknown): number | null {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
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
  const profiles = await listProjectAgentProfiles(scopedProjectId);
  const health = await getProjectAgentPoolHealth(scopedProjectId).catch(() => null);

  return NextResponse.json({
    projectId: scopedProjectId,
    health,
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
  });
}
