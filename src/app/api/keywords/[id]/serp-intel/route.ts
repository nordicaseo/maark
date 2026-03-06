import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db, ensureDb } from '@/db';
import { keywords } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { userCanAccessKeyword } from '@/lib/access';
import { getSerpIntelSnapshot } from '@/lib/serp/serp-intel';
import { logAlertEvent, logAuditEvent } from '@/lib/observability';

function parseId(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function runSerpIntel(params: {
  keywordId: number;
  userId: string;
  preferFresh?: boolean;
  ttlHours?: number;
}) {
  const [keyword] = await db
    .select({
      id: keywords.id,
      projectId: keywords.projectId,
      keyword: keywords.keyword,
    })
    .from(keywords)
    .where(and(eq(keywords.id, params.keywordId)))
    .limit(1);

  if (!keyword) {
    return { status: 404 as const, body: { error: 'Keyword not found' } };
  }

  const snapshot = await getSerpIntelSnapshot({
    keyword: keyword.keyword,
    projectId: keyword.projectId,
    preferFresh: params.preferFresh,
    ttlHours: params.ttlHours,
  });

  await logAuditEvent({
    userId: params.userId,
    action: 'keyword.serp_intel.run',
    resourceType: 'keyword',
    resourceId: keyword.id,
    projectId: keyword.projectId,
    metadata: {
      provider: snapshot.provider,
      competitors: snapshot.competitors.length,
      entities: snapshot.entities.length,
      lsiKeywords: snapshot.lsiKeywords.length,
      preferFresh: Boolean(params.preferFresh),
    },
  });

  return {
    status: 200 as const,
    body: {
      keywordId: keyword.id,
      keyword: keyword.keyword,
      projectId: keyword.projectId,
      snapshot,
    },
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureDb();
  const auth = await requireRole('writer');
  if (auth.error) return auth.error;

  const { id } = await params;
  const keywordId = parseId(id);
  if (!keywordId) {
    return NextResponse.json({ error: 'Invalid keyword id' }, { status: 400 });
  }

  if (!(await userCanAccessKeyword(auth.user, keywordId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const forceRefresh = req.nextUrl.searchParams.get('refresh') === '1';
    const ttlRaw = Number.parseInt(req.nextUrl.searchParams.get('ttlHours') || '', 10);
    const ttlHours = Number.isFinite(ttlRaw) && ttlRaw > 0 ? ttlRaw : undefined;

    const result = await runSerpIntel({
      keywordId,
      userId: auth.user.id,
      preferFresh: forceRefresh,
      ttlHours,
    });

    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    await logAlertEvent({
      source: 'keywords',
      eventType: 'serp_intel_failed',
      severity: 'warning',
      message: 'Keyword SERP intel generation failed.',
      resourceId: keywordId,
      metadata: { error: message },
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureDb();
  const auth = await requireRole('editor');
  if (auth.error) return auth.error;

  const { id } = await params;
  const keywordId = parseId(id);
  if (!keywordId) {
    return NextResponse.json({ error: 'Invalid keyword id' }, { status: 400 });
  }

  if (!(await userCanAccessKeyword(auth.user, keywordId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const ttlRaw = Number.parseInt(String(body.ttlHours ?? ''), 10);
    const ttlHours = Number.isFinite(ttlRaw) && ttlRaw > 0 ? ttlRaw : undefined;

    const result = await runSerpIntel({
      keywordId,
      userId: auth.user.id,
      preferFresh: true,
      ttlHours,
    });

    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    await logAlertEvent({
      source: 'keywords',
      eventType: 'serp_intel_refresh_failed',
      severity: 'warning',
      message: 'Keyword SERP intel refresh failed.',
      resourceId: keywordId,
      metadata: { error: message },
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
