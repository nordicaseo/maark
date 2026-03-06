import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { db, ensureDb } from '@/db';
import { siteDiscoveryUrls } from '@/db/schema';
import { getAuthUser } from '@/lib/auth';
import {
  getAccessibleProjectIds,
  getRequestedProjectId,
  isAdminUser,
} from '@/lib/access';

function parseOptionalBoolean(raw: string | null): boolean | null {
  if (!raw) return null;
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  return null;
}

export async function GET(req: NextRequest) {
  await ensureDb();
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const requestedProjectId = getRequestedProjectId(req);
  const sourceFilter = req.nextUrl.searchParams.get('source');
  const reasonFilter = req.nextUrl.searchParams.get('excludeReason');
  const isCandidateFilter = parseOptionalBoolean(req.nextUrl.searchParams.get('isCandidate'));

  const selectFields = {
    id: siteDiscoveryUrls.id,
    projectId: siteDiscoveryUrls.projectId,
    siteId: siteDiscoveryUrls.siteId,
    pageId: siteDiscoveryUrls.pageId,
    url: siteDiscoveryUrls.url,
    normalizedUrl: siteDiscoveryUrls.normalizedUrl,
    source: siteDiscoveryUrls.source,
    isCandidate: siteDiscoveryUrls.isCandidate,
    excludeReason: siteDiscoveryUrls.excludeReason,
    canonicalTarget: siteDiscoveryUrls.canonicalTarget,
    httpStatus: siteDiscoveryUrls.httpStatus,
    robots: siteDiscoveryUrls.robots,
    seenAt: siteDiscoveryUrls.seenAt,
    lastSeenAt: siteDiscoveryUrls.lastSeenAt,
    createdAt: siteDiscoveryUrls.createdAt,
    updatedAt: siteDiscoveryUrls.updatedAt,
  };

  const whereParts: SQL[] = [];
  if (sourceFilter) whereParts.push(eq(siteDiscoveryUrls.source, sourceFilter));
  if (reasonFilter) whereParts.push(eq(siteDiscoveryUrls.excludeReason, reasonFilter));
  if (isCandidateFilter !== null) whereParts.push(eq(siteDiscoveryUrls.isCandidate, isCandidateFilter ? 1 : 0));

  const combinePredicates = (predicates: SQL[]) => {
    if (predicates.length === 0) return undefined;
    if (predicates.length === 1) return predicates[0];
    return and(...predicates);
  };

  const buildBase = async () => {
    const predicate = combinePredicates(whereParts);
    if (predicate) {
      return db
        .select(selectFields)
        .from(siteDiscoveryUrls)
        .where(predicate)
        .orderBy(desc(siteDiscoveryUrls.updatedAt))
        .limit(500);
    }
    return db
      .select(selectFields)
      .from(siteDiscoveryUrls)
      .orderBy(desc(siteDiscoveryUrls.updatedAt))
      .limit(500);
  };

  if (isAdminUser(user)) {
    if (requestedProjectId !== null) {
      const rows = await db
        .select(selectFields)
        .from(siteDiscoveryUrls)
        .where(
          combinePredicates([
            eq(siteDiscoveryUrls.projectId, requestedProjectId),
            ...whereParts,
          ])
        )
        .orderBy(desc(siteDiscoveryUrls.updatedAt))
        .limit(500);
      return NextResponse.json(rows);
    }
    return NextResponse.json(await buildBase());
  }

  const accessibleProjectIds = await getAccessibleProjectIds(user);
  if (accessibleProjectIds.length === 0) return NextResponse.json([]);

  if (requestedProjectId !== null) {
    if (!accessibleProjectIds.includes(requestedProjectId)) return NextResponse.json([]);
    const rows = await db
      .select(selectFields)
      .from(siteDiscoveryUrls)
      .where(
        combinePredicates([
          eq(siteDiscoveryUrls.projectId, requestedProjectId),
          ...whereParts,
        ])
      )
      .orderBy(desc(siteDiscoveryUrls.updatedAt))
      .limit(500);
    return NextResponse.json(rows);
  }

  const rows = await db
    .select(selectFields)
    .from(siteDiscoveryUrls)
    .where(
      combinePredicates([
        sql`${siteDiscoveryUrls.projectId} IN (${sql.join(
          accessibleProjectIds.map((id) => sql`${id}`),
          sql`, `
        )})`,
        ...whereParts,
      ])
    )
    .orderBy(desc(siteDiscoveryUrls.updatedAt))
    .limit(500);
  return NextResponse.json(rows);
}
