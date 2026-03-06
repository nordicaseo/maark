import { and, eq, inArray } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/db';
import { pageKeywordMappings, pages, projects, keywords } from '@/db/schema';
import { getAuthUser } from '@/lib/auth';
import {
  getAccessibleProjectIds,
  getRequestedProjectId,
  isAdminUser,
  userCanAccessProject,
} from '@/lib/access';

function parsePositiveInt(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export async function GET(req: NextRequest) {
  await ensureDb();
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const queryProjectId = parsePositiveInt(req.nextUrl.searchParams.get('projectId'));
  const requestedProjectId = queryProjectId ?? getRequestedProjectId(req);

  let projectIds: number[] = [];
  if (requestedProjectId !== null) {
    if (!(await userCanAccessProject(user, requestedProjectId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    projectIds = [requestedProjectId];
  } else if (isAdminUser(user)) {
    const all = await db.select({ id: projects.id }).from(projects);
    projectIds = all.map((row: (typeof all)[number]) => Number(row.id));
  } else {
    projectIds = await getAccessibleProjectIds(user);
  }

  if (projectIds.length === 0) {
    return NextResponse.json({
      projectIds: [],
      summary: {
        totalPages: 0,
        pagesWithPrimary: 0,
        pagesWithoutPrimary: 0,
        duplicatePrimaryKeywordCount: 0,
      },
      pagesWithoutPrimary: [],
      duplicatePrimaryKeywords: [],
    });
  }

  const pageRows = await db
    .select({
      id: pages.id,
      projectId: pages.projectId,
      url: pages.url,
      title: pages.title,
      isActive: pages.isActive,
      isIndexable: pages.isIndexable,
      eligibilityState: pages.eligibilityState,
    })
    .from(pages)
    .where(inArray(pages.projectId, projectIds));

  const optimizationPages = pageRows.filter((row: (typeof pageRows)[number]) => {
    const active = Number(row.isActive ?? 1) === 1;
    const indexable = row.isIndexable === null || Number(row.isIndexable) === 1;
    const eligible = String(row.eligibilityState || 'eligible') === 'eligible';
    return active && indexable && eligible;
  });

  const primaryMappings = await db
    .select({
      projectId: pageKeywordMappings.projectId,
      pageId: pageKeywordMappings.pageId,
      keywordId: pageKeywordMappings.keywordId,
      keyword: keywords.keyword,
    })
    .from(pageKeywordMappings)
    .innerJoin(keywords, eq(keywords.id, pageKeywordMappings.keywordId))
    .where(
      and(
        inArray(pageKeywordMappings.projectId, projectIds),
        eq(pageKeywordMappings.mappingType, 'primary')
      )
    );

  const pageIdsWithPrimary = new Set<number>(
    primaryMappings.map((row: (typeof primaryMappings)[number]) => Number(row.pageId))
  );
  const pagesWithoutPrimary = optimizationPages
    .filter((page: (typeof optimizationPages)[number]) => !pageIdsWithPrimary.has(Number(page.id)))
    .slice(0, 40)
    .map((page: (typeof optimizationPages)[number]) => ({
      pageId: Number(page.id),
      projectId: Number(page.projectId),
      url: String(page.url),
      title: page.title ? String(page.title) : null,
    }));

  const primaryByKeyword = new Map<string, (typeof primaryMappings)[number][]>();
  for (const row of primaryMappings) {
    const key = `${row.projectId}:${row.keywordId}`;
    const list = primaryByKeyword.get(key) || [];
    list.push(row);
    primaryByKeyword.set(key, list);
  }

  const pageById = new Map<number, (typeof optimizationPages)[number]>(
    optimizationPages.map((row: (typeof optimizationPages)[number]) => [Number(row.id), row])
  );
  const duplicatePrimaryKeywords = Array.from(primaryByKeyword.entries())
    .filter((entry: [string, (typeof primaryMappings)[number][]]) => entry[1].length > 1)
    .map(([key, rows]: [string, (typeof primaryMappings)[number][]]) => {
      const [projectIdRaw, keywordIdRaw] = key.split(':');
      const projectId = Number.parseInt(projectIdRaw, 10);
      const keywordId = Number.parseInt(keywordIdRaw, 10);
      return {
        projectId,
        keywordId,
        keyword: String(rows[0]?.keyword || ''),
        pages: rows.map((entry: (typeof primaryMappings)[number]) => {
          const page = pageById.get(Number(entry.pageId));
          return {
            pageId: Number(entry.pageId),
            url: page ? String(page.url) : '',
            title: page?.title ? String(page.title) : null,
          };
        }),
      };
    })
    .slice(0, 25);

  return NextResponse.json({
    projectIds,
    summary: {
      totalPages: optimizationPages.length,
      pagesWithPrimary: pageIdsWithPrimary.size,
      pagesWithoutPrimary: Math.max(optimizationPages.length - pageIdsWithPrimary.size, 0),
      duplicatePrimaryKeywordCount: duplicatePrimaryKeywords.length,
    },
    pagesWithoutPrimary,
    duplicatePrimaryKeywords,
  });
}
