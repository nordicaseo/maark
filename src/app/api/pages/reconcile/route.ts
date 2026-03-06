import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { db, ensureDb } from '@/db';
import { pages, siteDiscoveryUrls } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { userCanAccessProject } from '@/lib/access';
import { logAuditEvent } from '@/lib/observability';
import { retirePageFromInventory, upsertDiscoveryUrl } from '@/lib/discovery/ledger';
import type { DiscoveryExcludeReason } from '@/types/page';

function parseProjectId(input: unknown): number | null {
  const value = Number.parseInt(String(input ?? ''), 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function resolveRetireReason(args: {
  httpStatus: number | null;
  isIndexable: number | null;
  discoveryCandidate: number | null;
  discoveryExcludeReason: string | null;
}): DiscoveryExcludeReason | null {
  if (args.httpStatus !== null && args.httpStatus !== 200) return 'non_200';
  if (args.isIndexable === 0) return 'non_indexable';
  if (args.discoveryCandidate === 0 && args.discoveryExcludeReason) {
    return args.discoveryExcludeReason as DiscoveryExcludeReason;
  }
  return null;
}

export async function POST(req: NextRequest) {
  await ensureDb();
  const auth = await requireRole('editor');
  if (auth.error) return auth.error;

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const projectId = parseProjectId(body.projectId);
  if (!projectId) {
    return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
  }
  if (!(await userCanAccessProject(auth.user, projectId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const dryRun = body.dryRun === true;
  const candidates = await db
    .select({
      id: pages.id,
      url: pages.url,
      normalizedUrl: pages.normalizedUrl,
      httpStatus: pages.httpStatus,
      isIndexable: pages.isIndexable,
    })
    .from(pages)
    .where(
      and(
        eq(pages.projectId, projectId),
        eq(pages.eligibilityState, 'eligible'),
        eq(pages.isActive, 1)
      )
    )
    .orderBy(desc(pages.updatedAt))
    .limit(25000);

  let retired = 0;
  let retained = 0;
  const retiredPages: Array<{ pageId: number; reason: string }> = [];

  for (const page of candidates) {
    const [latestDiscovery] = await db
      .select({
        isCandidate: siteDiscoveryUrls.isCandidate,
        excludeReason: siteDiscoveryUrls.excludeReason,
      })
      .from(siteDiscoveryUrls)
      .where(
        and(
          eq(siteDiscoveryUrls.projectId, projectId),
          eq(siteDiscoveryUrls.normalizedUrl, page.normalizedUrl)
        )
      )
      .orderBy(desc(siteDiscoveryUrls.updatedAt))
      .limit(1);

    const retireReason = resolveRetireReason({
      httpStatus: page.httpStatus,
      isIndexable: page.isIndexable,
      discoveryCandidate: latestDiscovery?.isCandidate ?? null,
      discoveryExcludeReason: latestDiscovery?.excludeReason ?? null,
    });

    if (!retireReason) {
      retained += 1;
      continue;
    }

    retired += 1;
    retiredPages.push({ pageId: page.id, reason: retireReason });
    if (dryRun) continue;

    await retirePageFromInventory({
      pageId: page.id,
      excludeReason: retireReason,
      httpStatus: page.httpStatus,
      isIndexable: page.isIndexable !== 0,
    });
    await upsertDiscoveryUrl({
      projectId,
      pageId: page.id,
      url: page.url,
      normalizedUrl: page.normalizedUrl,
      source: 'inventory',
      isCandidate: false,
      excludeReason: retireReason,
      metadata: {
        trigger: 'inventory_reconcile',
      },
    });
  }

  await logAuditEvent({
    userId: auth.user.id,
    action: 'pages.reconcile',
    resourceType: 'project',
    resourceId: projectId,
    projectId,
    metadata: {
      dryRun,
      scanned: candidates.length,
      retired,
      retained,
    },
    severity: retired > 0 ? 'warning' : 'info',
  });

  return NextResponse.json({
    success: true,
    dryRun,
    projectId,
    scanned: candidates.length,
    retired,
    retained,
    retiredPages: retiredPages.slice(0, 100),
  });
}

