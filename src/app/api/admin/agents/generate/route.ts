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

async function extractText(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const normalized = url.startsWith('http') ? url : `https://${url}`;
    const response = await fetch(normalized, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Maark/1.0; +https://maark.ai)',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<head[\s\S]*?<\/head>/gi, ' ')
      .replace(/<\/?(p|div|br|h[1-6]|li|tr|blockquote|section|article)[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n/g, '\n\n')
      .trim()
      .slice(0, 12000);
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireRole('super_admin');
  if (auth.error) return auth.error;

  try {
    await ensureDb();
    const body = await req.json();
    const projectId = parseProjectId(body.projectId);
    if (!projectId) {
      return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
    }
    if (!(await userCanAccessProject(auth.user, projectId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (!isAgentRole(body.role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
    }

    const laneKey = isLaneKey(body.laneKey) ? body.laneKey : undefined;
    if (laneKey && body.role !== 'writer') {
      return NextResponse.json(
        { error: 'laneKey is only supported for writer role generation' },
        { status: 400 }
      );
    }

    const urls = Array.isArray(body.urls)
      ? body.urls.map((item: unknown) => String(item || '').trim()).filter(Boolean).slice(0, 5)
      : [];
    const description =
      typeof body.description === 'string' ? body.description.trim() : '';
    const apply =
      body.apply === undefined ? true : body.apply === true || String(body.apply) === 'true';

    const [projectRow] = await db
      .select({ name: projects.name })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);

    const sourceDocuments: Array<{ name: string; content: string }> = [];
    for (const url of urls) {
      try {
        const text = await extractText(url);
        if (text.length > 80) {
          sourceDocuments.push({ name: url, content: text });
        }
      } catch {
        // Non-fatal URL extraction failures are ignored.
      }
    }

    const generated = await generateAgentKnowledgeProfile({
      projectName: projectRow?.name || `Project ${projectId}`,
      role: body.role,
      laneKey,
      description,
      sourceUrls: urls,
      sourceDocuments,
    });

    let profile: unknown = null;
    if (apply) {
      if (body.role === 'writer' && laneKey) {
        profile = await upsertProjectAgentLaneProfile({
          projectId,
          role: body.role,
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
          role: body.role,
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
      action: 'admin.agent_profile.generate',
      resourceType: 'project_agent_profile',
      resourceId: `${projectId}:${body.role}${laneKey ? `:${laneKey}` : ''}`,
      projectId,
      metadata: {
        role: body.role,
        laneKey: laneKey ?? null,
        urls: urls.length,
        applied: apply,
        generatedKnowledgeParts: generated.knowledgeParts.length,
      },
    });

    return NextResponse.json({
      ok: true,
      projectId,
      role: body.role,
      laneKey: laneKey ?? null,
      generated,
      profile,
    });
  } catch (error) {
    await logAlertEvent({
      source: 'admin',
      eventType: 'agent_profile_generate_failed',
      severity: 'error',
      message: 'Failed to generate agent profile knowledge.',
      metadata: { error: error instanceof Error ? error.message : 'Unknown error' },
    });
    return NextResponse.json({ error: 'Failed to generate agent profile' }, { status: 500 });
  }
}
