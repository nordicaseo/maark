import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { dbNow } from '@/db/utils';
import {
  pageArtifactJobs,
  pageArtifacts,
  pageIssues,
  pages,
  pageSnapshots,
} from '@/db/schema';
import {
  isArtifactWorkerConfigured,
  processArtifactsInWorker,
  type ProcessArtifactsRequest,
} from '@/lib/crawler/artifact-worker';
import { logAlertEvent } from '@/lib/observability';

const DEFAULT_MAX_ATTEMPTS = 3;

type ArtifactJobAction = 'process' | 'reclean' | 'regrade' | 'reprocess';

function toDbTime(ms: number): Date | string {
  return process.env.POSTGRES_URL ? new Date(ms) : new Date(ms).toISOString();
}

function toEpochMs(value: unknown): number | null {
  if (!value) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function isDue(nextAttemptAt: unknown): boolean {
  const epoch = toEpochMs(nextAttemptAt);
  if (epoch === null) return true;
  return epoch <= Date.now();
}

function nextBackoffMs(attempt: number): number {
  const base = 60_000;
  const cap = 30 * 60_000;
  const multiplier = Math.max(1, 2 ** (attempt - 1));
  return Math.min(cap, base * multiplier);
}

function parseSnapshotData(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'object') return { ...(value as Record<string, unknown>) };
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

async function nextArtifactVersion(snapshotId: number): Promise<number> {
  const [row] = await db
    .select({
      maxVersion: sql<number>`COALESCE(MAX(${pageArtifacts.version}), 0)`,
    })
    .from(pageArtifacts)
    .where(eq(pageArtifacts.snapshotId, snapshotId))
    .limit(1);

  return Number(row?.maxVersion || 0) + 1;
}

async function findLatestReadyArtifact(
  snapshotId: number,
  artifactType: 'raw_html' | 'clean_html'
) {
  const [row] = await db
    .select()
    .from(pageArtifacts)
    .where(
      and(
        eq(pageArtifacts.snapshotId, snapshotId),
        eq(pageArtifacts.artifactType, artifactType),
        eq(pageArtifacts.status, 'ready')
      )
    )
    .orderBy(desc(pageArtifacts.version), desc(pageArtifacts.createdAt))
    .limit(1);
  return row || null;
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sanitizeIssueType(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

function toIssueSeverity(value: unknown): 'low' | 'medium' | 'high' | 'critical' {
  const normalized = String(value || 'medium').toLowerCase();
  if (normalized === 'low' || normalized === 'medium' || normalized === 'high' || normalized === 'critical') {
    return normalized;
  }
  return 'medium';
}

async function recordArtifactFailure(args: {
  projectId: number;
  pageId: number;
  runId: number | null;
  snapshotId: number;
  error: string;
  attempts: number;
  maxAttempts: number;
  terminal: boolean;
}) {
  const version = await nextArtifactVersion(args.snapshotId);
  await db.insert(pageArtifacts).values({
    projectId: args.projectId,
    pageId: args.pageId,
    runId: args.runId,
    snapshotId: args.snapshotId,
    artifactType: 'grade_report',
    status: args.terminal ? 'dead_letter' : 'failed',
    version,
    objectKey: null,
    checksum: null,
    sizeBytes: null,
    mimeType: 'application/json',
    gradeScore: null,
    metadata: {
      failure: true,
      attempts: args.attempts,
      maxAttempts: args.maxAttempts,
    },
    lastError: args.error,
    attempts: args.attempts,
    maxAttempts: args.maxAttempts,
    nextAttemptAt: null,
    readyAt: null,
    createdAt: dbNow(),
    updatedAt: dbNow(),
  });
}

async function persistProcessedArtifacts(args: {
  projectId: number;
  pageId: number;
  runId: number | null;
  snapshotId: number;
  processedAt?: string;
  workerResult: Awaited<ReturnType<typeof processArtifactsInWorker>>;
}) {
  const version = await nextArtifactVersion(args.snapshotId);

  const [rawArtifact] = await db
    .insert(pageArtifacts)
    .values({
      projectId: args.projectId,
      pageId: args.pageId,
      runId: args.runId,
      snapshotId: args.snapshotId,
      artifactType: 'raw_html',
      status: 'ready',
      version,
      objectKey: args.workerResult.raw.objectKey,
      checksum: args.workerResult.raw.checksum || null,
      sizeBytes: args.workerResult.raw.sizeBytes ?? null,
      mimeType: args.workerResult.raw.mimeType || 'text/html',
      gradeScore: null,
      metadata: null,
      lastError: null,
      attempts: 0,
      maxAttempts: DEFAULT_MAX_ATTEMPTS,
      nextAttemptAt: null,
      readyAt: dbNow(),
      createdAt: dbNow(),
      updatedAt: dbNow(),
    })
    .returning();

  const [cleanArtifact] = await db
    .insert(pageArtifacts)
    .values({
      projectId: args.projectId,
      pageId: args.pageId,
      runId: args.runId,
      snapshotId: args.snapshotId,
      artifactType: 'clean_html',
      status: 'ready',
      version,
      objectKey: args.workerResult.clean.objectKey,
      checksum: args.workerResult.clean.checksum || null,
      sizeBytes: args.workerResult.clean.sizeBytes ?? null,
      mimeType: args.workerResult.clean.mimeType || 'text/html',
      gradeScore: null,
      metadata: null,
      lastError: null,
      attempts: 0,
      maxAttempts: DEFAULT_MAX_ATTEMPTS,
      nextAttemptAt: null,
      readyAt: dbNow(),
      createdAt: dbNow(),
      updatedAt: dbNow(),
    })
    .returning();

  const gradeReport = args.workerResult.grade?.report;
  const [gradeArtifact] = await db
    .insert(pageArtifacts)
    .values({
      projectId: args.projectId,
      pageId: args.pageId,
      runId: args.runId,
      snapshotId: args.snapshotId,
      artifactType: 'grade_report',
      status: 'ready',
      version,
      objectKey: args.workerResult.grade.artifact.objectKey,
      checksum: args.workerResult.grade.artifact.checksum || null,
      sizeBytes: args.workerResult.grade.artifact.sizeBytes ?? null,
      mimeType: args.workerResult.grade.artifact.mimeType || 'application/json',
      gradeScore: Number.isFinite(gradeReport?.score) ? Number(gradeReport?.score) : null,
      metadata: gradeReport || null,
      lastError: null,
      attempts: 0,
      maxAttempts: DEFAULT_MAX_ATTEMPTS,
      nextAttemptAt: null,
      readyAt: dbNow(),
      createdAt: dbNow(),
      updatedAt: dbNow(),
    })
    .returning();

  const [snapshot] = await db
    .select({
      id: pageSnapshots.id,
      snapshotData: pageSnapshots.snapshotData,
    })
    .from(pageSnapshots)
    .where(eq(pageSnapshots.id, args.snapshotId))
    .limit(1);

  if (snapshot) {
    const snapshotData = parseSnapshotData(snapshot.snapshotData);
    delete snapshotData.rawHtml;
    delete snapshotData.rawMarkdown;
    snapshotData.artifactPipeline = {
      ...(snapshotData.artifactPipeline && typeof snapshotData.artifactPipeline === 'object'
        ? (snapshotData.artifactPipeline as Record<string, unknown>)
        : {}),
      status: 'ready',
      version,
      processedAt: args.processedAt || new Date().toISOString(),
      rawArtifactId: rawArtifact.id,
      cleanArtifactId: cleanArtifact.id,
      gradeArtifactId: gradeArtifact.id,
      gradeScore: gradeArtifact.gradeScore,
    };

    await db
      .update(pageSnapshots)
      .set({
        rawArtifactId: rawArtifact.id,
        cleanArtifactId: cleanArtifact.id,
        gradeArtifactId: gradeArtifact.id,
        snapshotData,
      })
      .where(eq(pageSnapshots.id, args.snapshotId));
  }

  await db
    .update(pages)
    .set({
      latestRawArtifactId: rawArtifact.id,
      latestCleanArtifactId: cleanArtifact.id,
      latestGradeArtifactId: gradeArtifact.id,
      updatedAt: dbNow(),
    })
    .where(eq(pages.id, args.pageId));

  await db
    .update(pageIssues)
    .set({
      isOpen: 0,
      resolvedAt: dbNow(),
      lastSeenAt: dbNow(),
    })
    .where(
      and(
        eq(pageIssues.pageId, args.pageId),
        eq(pageIssues.isOpen, 1),
        sql`${pageIssues.issueType} LIKE 'content_grade_%'`
      )
    );

  for (const issue of gradeReport?.issues || []) {
    const issueType = sanitizeIssueType(issue.issueType || 'quality_gap');
    if (!issueType) continue;
    await db.insert(pageIssues).values({
      pageId: args.pageId,
      snapshotId: args.snapshotId,
      issueType: `content_grade_${issueType}`,
      severity: toIssueSeverity(issue.severity),
      message: String(issue.message || 'Content quality issue detected'),
      isOpen: 1,
      metadata: issue.metadata || null,
      firstSeenAt: dbNow(),
      lastSeenAt: dbNow(),
      resolvedAt: null,
    });
  }

  return {
    rawArtifactId: Number(rawArtifact.id),
    cleanArtifactId: Number(cleanArtifact.id),
    gradeArtifactId: Number(gradeArtifact.id),
    score: gradeArtifact.gradeScore,
  };
}

export async function enqueuePageArtifactJob(args: {
  projectId: number;
  pageId: number;
  runId?: number | null;
  snapshotId: number;
  action?: ArtifactJobAction;
  payload?: Record<string, unknown> | null;
  maxAttempts?: number;
}) {
  const action = args.action || 'process';

  const [existing] = await db
    .select()
    .from(pageArtifactJobs)
    .where(
      and(
        eq(pageArtifactJobs.snapshotId, args.snapshotId),
        eq(pageArtifactJobs.action, action),
        sql`${pageArtifactJobs.state} IN ('queued', 'processing')`
      )
    )
    .orderBy(desc(pageArtifactJobs.updatedAt))
    .limit(1);

  if (existing) {
    return {
      job: existing,
      reused: true,
    };
  }

  const [job] = await db
    .insert(pageArtifactJobs)
    .values({
      projectId: args.projectId,
      pageId: args.pageId,
      runId: args.runId ?? null,
      snapshotId: args.snapshotId,
      action,
      state: 'queued',
      attempts: 0,
      maxAttempts: Math.max(1, Math.min(8, args.maxAttempts ?? DEFAULT_MAX_ATTEMPTS)),
      nextAttemptAt: null,
      leaseUntil: null,
      lastError: null,
      payload: args.payload ?? null,
      startedAt: null,
      finishedAt: null,
      createdAt: dbNow(),
      updatedAt: dbNow(),
    })
    .returning();

  return {
    job,
    reused: false,
  };
}

function buildWorkerPayload(args: {
  jobAction: ArtifactJobAction;
  snapshotData: Record<string, unknown>;
  pageUrl: string;
  projectId: number;
  pageId: number;
  runId: number | null;
  snapshotId: number;
  rawArtifactObjectKey: string | null;
  cleanArtifactObjectKey: string | null;
  payload: Record<string, unknown>;
}): ProcessArtifactsRequest {
  const base: ProcessArtifactsRequest = {
    projectId: args.projectId,
    pageId: args.pageId,
    runId: args.runId,
    snapshotId: args.snapshotId,
    url: args.pageUrl,
    action: args.jobAction,
    metadata: {
      trigger: args.payload.trigger || 'crawler',
      snapshotCreatedAt: args.snapshotData.createdAt || null,
    },
  };

  if (args.jobAction === 'regrade') {
    return {
      ...base,
      cleanObjectKey: args.cleanArtifactObjectKey || null,
      rawObjectKey: args.rawArtifactObjectKey || null,
    };
  }

  if (args.jobAction === 'reclean' || args.jobAction === 'reprocess') {
    return {
      ...base,
      rawObjectKey: args.rawArtifactObjectKey || null,
      cleanObjectKey: args.cleanArtifactObjectKey || null,
      rawHtml: asString(args.payload.rawHtml) || asString(args.snapshotData.rawHtml) || undefined,
      rawMarkdown: asString(args.payload.rawMarkdown) || asString(args.snapshotData.rawMarkdown),
    };
  }

  return {
    ...base,
    rawHtml: asString(args.payload.rawHtml) || asString(args.snapshotData.rawHtml) || undefined,
    rawMarkdown: asString(args.payload.rawMarkdown) || asString(args.snapshotData.rawMarkdown),
  };
}

export async function processPageArtifactJob(jobId: number) {
  const [job] = await db
    .select()
    .from(pageArtifactJobs)
    .where(eq(pageArtifactJobs.id, jobId))
    .limit(1);

  if (!job) {
    return { jobId, state: 'missing' as const, message: 'Artifact job not found' };
  }
  if (job.state === 'done' || job.state === 'failed' || job.state === 'dead_letter') {
    return { jobId, state: job.state as 'done' | 'failed' | 'dead_letter', message: 'Already finalized' };
  }
  if (!isDue(job.nextAttemptAt)) {
    return { jobId, state: 'deferred' as const, message: 'Artifact job not due yet' };
  }

  const nextAttempt = (job.attempts ?? 0) + 1;
  await db
    .update(pageArtifactJobs)
    .set({
      state: 'processing',
      attempts: nextAttempt,
      startedAt: job.startedAt ?? dbNow(),
      leaseUntil: toDbTime(Date.now() + 2 * 60_000),
      updatedAt: dbNow(),
    })
    .where(eq(pageArtifactJobs.id, jobId));

  try {
    if (!isArtifactWorkerConfigured()) {
      throw new Error('Artifact worker is not configured.');
    }

    const [snapshotRow] = await db
      .select({
        id: pageSnapshots.id,
        runId: pageSnapshots.runId,
        snapshotData: pageSnapshots.snapshotData,
      })
      .from(pageSnapshots)
      .where(eq(pageSnapshots.id, job.snapshotId))
      .limit(1);

    if (!snapshotRow) {
      throw new Error('Snapshot not found for artifact job.');
    }

    const [pageRow] = await db
      .select({
        id: pages.id,
        url: pages.url,
      })
      .from(pages)
      .where(eq(pages.id, job.pageId))
      .limit(1);

    if (!pageRow) {
      throw new Error('Page not found for artifact job.');
    }

    const snapshotData = parseSnapshotData(snapshotRow.snapshotData);
    const payload =
      job.payload && typeof job.payload === 'object'
        ? (job.payload as Record<string, unknown>)
        : {};

    const rawArtifact = await findLatestReadyArtifact(snapshotRow.id, 'raw_html');
    const cleanArtifact = await findLatestReadyArtifact(snapshotRow.id, 'clean_html');
    const action = String(job.action || 'process') as ArtifactJobAction;

    const workerPayload = buildWorkerPayload({
      jobAction: action,
      snapshotData,
      pageUrl: pageRow.url,
      projectId: job.projectId,
      pageId: job.pageId,
      runId: job.runId ?? snapshotRow.runId ?? null,
      snapshotId: snapshotRow.id,
      rawArtifactObjectKey: rawArtifact?.objectKey || null,
      cleanArtifactObjectKey: cleanArtifact?.objectKey || null,
      payload,
    });

    if (!workerPayload.rawHtml && !workerPayload.rawObjectKey && action !== 'regrade') {
      throw new Error('No raw HTML available to process artifact job.');
    }
    if (action === 'regrade' && !workerPayload.cleanObjectKey && !workerPayload.rawObjectKey) {
      throw new Error('No clean or raw artifact object available for regrade.');
    }

    const workerResult = await processArtifactsInWorker(workerPayload);
    const stored = await persistProcessedArtifacts({
      projectId: job.projectId,
      pageId: job.pageId,
      runId: job.runId ?? snapshotRow.runId ?? null,
      snapshotId: snapshotRow.id,
      processedAt: workerResult.processedAt,
      workerResult,
    });

    await db
      .update(pageArtifactJobs)
      .set({
        state: 'done',
        leaseUntil: null,
        lastError: null,
        nextAttemptAt: null,
        finishedAt: dbNow(),
        updatedAt: dbNow(),
      })
      .where(eq(pageArtifactJobs.id, jobId));

    return {
      jobId,
      state: 'done' as const,
      result: stored,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown artifact processing error';
    const willRetry = nextAttempt < (job.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);

    await recordArtifactFailure({
      projectId: job.projectId,
      pageId: job.pageId,
      runId: job.runId ?? null,
      snapshotId: job.snapshotId,
      error: errorMessage,
      attempts: nextAttempt,
      maxAttempts: job.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      terminal: !willRetry,
    });

    if (willRetry) {
      await db
        .update(pageArtifactJobs)
        .set({
          state: 'queued',
          leaseUntil: null,
          lastError: errorMessage,
          nextAttemptAt: toDbTime(Date.now() + nextBackoffMs(nextAttempt)),
          updatedAt: dbNow(),
        })
        .where(eq(pageArtifactJobs.id, jobId));

      await logAlertEvent({
        source: 'crawler',
        eventType: 'artifact_job_retrying',
        severity: 'warning',
        message: 'Artifact job failed and has been re-queued.',
        projectId: job.projectId,
        resourceId: job.pageId,
        metadata: {
          jobId,
          snapshotId: job.snapshotId,
          attempts: nextAttempt,
          maxAttempts: job.maxAttempts,
          error: errorMessage,
        },
      });

      return {
        jobId,
        state: 'queued' as const,
        message: errorMessage,
        attempts: nextAttempt,
      };
    }

    await db
      .update(pageArtifactJobs)
      .set({
        state: 'dead_letter',
        leaseUntil: null,
        lastError: errorMessage,
        nextAttemptAt: null,
        finishedAt: dbNow(),
        updatedAt: dbNow(),
      })
      .where(eq(pageArtifactJobs.id, jobId));

    await logAlertEvent({
      source: 'crawler',
      eventType: 'artifact_job_dead_letter',
      severity: 'error',
      message: 'Artifact job failed after maximum retry attempts.',
      projectId: job.projectId,
      resourceId: job.pageId,
      metadata: {
        jobId,
        snapshotId: job.snapshotId,
        attempts: nextAttempt,
        maxAttempts: job.maxAttempts,
        error: errorMessage,
      },
    });

    return {
      jobId,
      state: 'dead_letter' as const,
      message: errorMessage,
      attempts: nextAttempt,
    };
  }
}

export async function processDuePageArtifactJobs(args?: { projectId?: number; limit?: number }) {
  const limit = Math.max(1, Math.min(50, args?.limit ?? 5));

  const queuedRows: Array<typeof pageArtifactJobs.$inferSelect> = await db
    .select()
    .from(pageArtifactJobs)
    .where(
      and(
        eq(pageArtifactJobs.state, 'queued'),
        ...(args?.projectId ? [eq(pageArtifactJobs.projectId, args.projectId)] : [])
      )
    )
    .orderBy(desc(pageArtifactJobs.createdAt))
    .limit(limit * 5);

  const dueRows = queuedRows.filter((row) => isDue(row.nextAttemptAt)).slice(0, limit);
  const results = [] as Array<Awaited<ReturnType<typeof processPageArtifactJob>>>;

  for (const row of dueRows) {
    results.push(await processPageArtifactJob(row.id));
  }

  const states = {
    done: 0,
    queued: 0,
    deadLetter: 0,
    deferred: 0,
    missing: 0,
  };

  for (const entry of results) {
    if (entry.state === 'done') states.done += 1;
    else if (entry.state === 'queued') states.queued += 1;
    else if (entry.state === 'dead_letter') states.deadLetter += 1;
    else if (entry.state === 'deferred') states.deferred += 1;
    else if (entry.state === 'missing') states.missing += 1;
  }

  return {
    requestedLimit: limit,
    processedCount: results.length,
    states,
    results,
  };
}
