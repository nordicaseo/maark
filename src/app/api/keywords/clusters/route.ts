import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db, ensureDb } from '@/db';
import { keywordClusterMembers, keywordClusters, keywords } from '@/db/schema';
import { getAuthUser, requireRole } from '@/lib/auth';
import { getAccessibleProjectIds, getRequestedProjectId, isAdminUser, userCanAccessProject } from '@/lib/access';
import { dbNow } from '@/db/utils';
import { logAuditEvent } from '@/lib/observability';

interface ClusterResponse {
  id: number;
  projectId: number;
  name: string;
  status: string;
  notes: string | null;
  mainKeywordId: number | null;
  mainKeyword: string | null;
  memberCount: number;
  secondaryKeywords: Array<{ id: number; keyword: string }>;
  createdAt: string | Date;
  updatedAt: string | Date;
}

function parseProjectId(value: unknown): number | null {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export async function GET(req: NextRequest) {
  await ensureDb();
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const requestedProjectId = getRequestedProjectId(req);

  let projectIds: number[] = [];
  if (requestedProjectId !== null) {
    if (!(await userCanAccessProject(user, requestedProjectId))) {
      return NextResponse.json([], { status: 200 });
    }
    projectIds = [requestedProjectId];
  } else if (isAdminUser(user)) {
    const rows = await db.select({ projectId: keywordClusters.projectId }).from(keywordClusters);
    projectIds = Array.from(
      new Set(
        rows
          .map((row: (typeof rows)[number]) => Number(row.projectId || 0))
          .filter((value: number) => Number.isFinite(value) && value > 0)
      )
    );
  } else {
    projectIds = await getAccessibleProjectIds(user);
  }

  if (projectIds.length === 0) {
    return NextResponse.json([]);
  }

  const rows = await db
    .select({
      id: keywordClusters.id,
      projectId: keywordClusters.projectId,
      name: keywordClusters.name,
      status: keywordClusters.status,
      notes: keywordClusters.notes,
      mainKeywordId: keywordClusters.mainKeywordId,
      mainKeyword: keywords.keyword,
      createdAt: keywordClusters.createdAt,
      updatedAt: keywordClusters.updatedAt,
    })
    .from(keywordClusters)
    .leftJoin(keywords, eq(keywordClusters.mainKeywordId, keywords.id))
    .where(inArray(keywordClusters.projectId, projectIds))
    .orderBy(desc(keywordClusters.updatedAt));

  if (rows.length === 0) {
    return NextResponse.json([]);
  }

  const clusterIds = rows.map((row: (typeof rows)[number]) => row.id);
  const members = await db
    .select({
      clusterId: keywordClusterMembers.clusterId,
      keywordId: keywordClusterMembers.keywordId,
      role: keywordClusterMembers.role,
      keyword: keywords.keyword,
    })
    .from(keywordClusterMembers)
    .leftJoin(keywords, eq(keywordClusterMembers.keywordId, keywords.id))
    .where(inArray(keywordClusterMembers.clusterId, clusterIds));

  const memberMap = new Map<number, Array<{ id: number; keyword: string; role: string }>>();
  for (const member of members) {
    const existing = memberMap.get(member.clusterId) || [];
    existing.push({
      id: Number(member.keywordId),
      keyword: String(member.keyword || ''),
      role: String(member.role || 'secondary'),
    });
    memberMap.set(member.clusterId, existing);
  }

  const payload: ClusterResponse[] = rows.map((cluster: (typeof rows)[number]) => {
    const clusterMembers = memberMap.get(cluster.id) || [];
    const secondaryKeywords = clusterMembers
      .filter((member) => member.role !== 'primary')
      .map((member) => ({ id: member.id, keyword: member.keyword }));

    return {
      id: cluster.id,
      projectId: cluster.projectId,
      name: cluster.name,
      status: cluster.status,
      notes: cluster.notes ? String(cluster.notes) : null,
      mainKeywordId: cluster.mainKeywordId ? Number(cluster.mainKeywordId) : null,
      mainKeyword: cluster.mainKeyword ? String(cluster.mainKeyword) : null,
      memberCount: clusterMembers.length,
      secondaryKeywords,
      createdAt: cluster.createdAt,
      updatedAt: cluster.updatedAt,
    };
  });

  return NextResponse.json(payload);
}

export async function POST(req: NextRequest) {
  await ensureDb();
  const auth = await requireRole('editor');
  if (auth.error) return auth.error;

  try {
    const body = await req.json();
    const requestedProjectId = getRequestedProjectId(req);
    const projectId = parseProjectId(body.projectId ?? requestedProjectId);

    if (!projectId) {
      return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
    }
    if (!(await userCanAccessProject(auth.user, projectId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) {
      return NextResponse.json({ error: 'Cluster name is required' }, { status: 400 });
    }

    const mainKeywordId = parseProjectId(body.mainKeywordId);
    if (!mainKeywordId) {
      return NextResponse.json({ error: 'mainKeywordId is required' }, { status: 400 });
    }

    const [mainKeyword] = await db
      .select({ id: keywords.id, projectId: keywords.projectId, keyword: keywords.keyword })
      .from(keywords)
      .where(and(eq(keywords.id, mainKeywordId), eq(keywords.projectId, projectId)))
      .limit(1);

    if (!mainKeyword) {
      return NextResponse.json({ error: 'Main keyword not found in project scope' }, { status: 404 });
    }

    const secondaryKeywordIds: number[] = [];
    if (Array.isArray(body.secondaryKeywordIds)) {
      const unique = new Set<number>();
      for (const value of body.secondaryKeywordIds) {
        const parsed = parseProjectId(value);
        if (!parsed || parsed === mainKeywordId) continue;
        unique.add(parsed);
      }
      secondaryKeywordIds.push(...Array.from(unique));
    }

    let validSecondaryIds: number[] = [];
    if (secondaryKeywordIds.length > 0) {
      const validRows = await db
        .select({ id: keywords.id })
        .from(keywords)
        .where(
          and(
            eq(keywords.projectId, projectId),
            inArray(keywords.id, secondaryKeywordIds)
          )
        );
      validSecondaryIds = validRows.map((row: (typeof validRows)[number]) => row.id);
    }

    const [cluster] = await db
      .insert(keywordClusters)
      .values({
        projectId,
        name,
        mainKeywordId,
        status: 'active',
        notes: typeof body.notes === 'string' ? body.notes.trim() || null : null,
        createdById: auth.user.id,
      })
      .returning();

    await db.insert(keywordClusterMembers).values({
      clusterId: cluster.id,
      keywordId: mainKeywordId,
      role: 'primary',
    });

    if (validSecondaryIds.length > 0) {
      await db.insert(keywordClusterMembers).values(
        validSecondaryIds.map((keywordId) => ({
          clusterId: cluster.id,
          keywordId,
          role: 'secondary',
        }))
      );
    }

    await db
      .update(keywordClusters)
      .set({ updatedAt: dbNow() })
      .where(eq(keywordClusters.id, cluster.id));

    await logAuditEvent({
      userId: auth.user.id,
      action: 'keyword_cluster.create',
      resourceType: 'keyword_cluster',
      resourceId: cluster.id,
      projectId,
      metadata: {
        name,
        mainKeywordId,
        secondaryCount: validSecondaryIds.length,
      },
    });

    return NextResponse.json({
      id: cluster.id,
      projectId,
      name,
      status: 'active',
      mainKeywordId,
      mainKeyword: mainKeyword.keyword,
      memberCount: 1 + validSecondaryIds.length,
      secondaryKeywordIds: validSecondaryIds,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const isDuplicate = /unique|duplicate|constraint/i.test(message);
    return NextResponse.json(
      { error: isDuplicate ? 'A cluster with this name already exists in the project.' : 'Failed to create cluster' },
      { status: isDuplicate ? 409 : 500 }
    );
  }
}
