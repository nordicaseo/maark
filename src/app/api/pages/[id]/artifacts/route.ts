import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { db, ensureDb } from '@/db';
import { pageArtifactJobs, pageArtifacts, pageSnapshots, pages } from '@/db/schema';
import { requireRole, getAuthUser } from '@/lib/auth';
import { userCanAccessPage } from '@/lib/access';
import {
  enqueuePageArtifactJob,
  processPageArtifactJob,
} from '@/lib/discovery/page-artifact-queue';
import type { PageArtifactRecord } from '@/types/page';

type PageArtifactJobRow = typeof pageArtifactJobs.$inferSelect;

function parsePositiveInt(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseOptionalPositiveInt(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
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
  const pageId = parsePositiveInt(id);
  if (!pageId) {
    return NextResponse.json({ error: 'Invalid page id' }, { status: 400 });
  }
  if (!(await userCanAccessPage(user, pageId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const snapshotId = parsePositiveInt(req.nextUrl.searchParams.get('snapshotId'));
  const limitRaw = Number.parseInt(String(req.nextUrl.searchParams.get('limit') || ''), 10);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 60;

  const records = (snapshotId
    ? await db
        .select()
        .from(pageArtifacts)
        .where(and(eq(pageArtifacts.pageId, pageId), eq(pageArtifacts.snapshotId, snapshotId)))
        .orderBy(desc(pageArtifacts.createdAt))
        .limit(limit)
    : await db
        .select()
        .from(pageArtifacts)
        .where(eq(pageArtifacts.pageId, pageId))
        .orderBy(desc(pageArtifacts.createdAt))
        .limit(limit)) as PageArtifactRecord[];

  const jobs: PageArtifactJobRow[] = (snapshotId
    ? await db
        .select()
        .from(pageArtifactJobs)
        .where(and(eq(pageArtifactJobs.pageId, pageId), eq(pageArtifactJobs.snapshotId, snapshotId)))
        .orderBy(desc(pageArtifactJobs.createdAt))
        .limit(20)
    : await db
        .select()
        .from(pageArtifactJobs)
        .where(eq(pageArtifactJobs.pageId, pageId))
        .orderBy(desc(pageArtifactJobs.createdAt))
        .limit(20));

  return NextResponse.json({
    pageId,
    snapshotId,
    artifacts: records,
    jobs: jobs.map((job) => ({
      id: Number(job.id),
      snapshotId: Number(job.snapshotId),
      action: String(job.action || 'process'),
      state: String(job.state || 'queued'),
      attempts: Number(job.attempts || 0),
      maxAttempts: Number(job.maxAttempts || 0),
      nextAttemptAt: job.nextAttemptAt ? String(job.nextAttemptAt) : null,
      lastError: job.lastError ? String(job.lastError) : null,
      updatedAt: job.updatedAt ? String(job.updatedAt) : null,
    })),
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureDb();
  const auth = await requireRole('editor');
  if (auth.error) return auth.error;

  const { id } = await params;
  const pageId = parsePositiveInt(id);
  if (!pageId) {
    return NextResponse.json({ error: 'Invalid page id' }, { status: 400 });
  }
  if (!(await userCanAccessPage(auth.user, pageId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const actionRaw = String(body.action || 'reprocess').toLowerCase();
  const action =
    actionRaw === 'reclean' || actionRaw === 'regrade' || actionRaw === 'reprocess'
      ? actionRaw
      : 'reprocess';

  const explicitSnapshotId = parseOptionalPositiveInt(body.snapshotId);
  const processNow = body.processNow === true || body.processNow === 'true';

  let snapshotId = explicitSnapshotId;
  if (!snapshotId) {
    const [latestSnapshot] = await db
      .select({ id: pageSnapshots.id, runId: pageSnapshots.runId })
      .from(pageSnapshots)
      .where(eq(pageSnapshots.pageId, pageId))
      .orderBy(desc(pageSnapshots.createdAt))
      .limit(1);

    if (!latestSnapshot) {
      return NextResponse.json({ error: 'No snapshots found for page' }, { status: 404 });
    }
    snapshotId = Number(latestSnapshot.id);
  }

  const [snapshot] = await db
    .select({
      id: pageSnapshots.id,
      runId: pageSnapshots.runId,
      pageId: pageSnapshots.pageId,
      projectId: pages.projectId,
    })
    .from(pageSnapshots)
    .innerJoin(pages, eq(pages.id, pageSnapshots.pageId))
    .where(and(eq(pageSnapshots.id, snapshotId), eq(pageSnapshots.pageId, pageId)))
    .limit(1);

  if (!snapshot) {
    return NextResponse.json({ error: 'Snapshot not found for page' }, { status: 404 });
  }

  const enqueued = await enqueuePageArtifactJob({
    projectId: Number(snapshot.projectId),
    pageId,
    runId: snapshot.runId ?? null,
    snapshotId: Number(snapshot.id),
    action,
    payload: {
      trigger: 'manual',
      requestedBy: auth.user.id,
    },
  });

  if (!processNow) {
    return NextResponse.json({
      success: true,
      queued: true,
      reused: enqueued.reused,
      jobId: Number(enqueued.job.id),
      snapshotId: Number(snapshot.id),
      action,
    });
  }

  const processed = await processPageArtifactJob(Number(enqueued.job.id));
  return NextResponse.json({
    success: processed.state === 'done',
    queued: true,
    reused: enqueued.reused,
    jobId: Number(enqueued.job.id),
    snapshotId: Number(snapshot.id),
    action,
    processed,
  });
}
