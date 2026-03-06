import { NextRequest, NextResponse } from 'next/server';
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { db, ensureDb } from '@/db';
import { keywords, pageKeywordMappings, pages } from '@/db/schema';
import { dbNow } from '@/db/utils';
import { getAuthUser, requireRole } from '@/lib/auth';
import { userCanAccessPage } from '@/lib/access';
import { logAuditEvent } from '@/lib/observability';

function parsePositiveInt(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeKeywordIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const out = new Set<number>();
  for (const item of value) {
    const parsed = Number.parseInt(String(item), 10);
    if (Number.isFinite(parsed) && parsed > 0) out.add(parsed);
  }
  return Array.from(out);
}

async function resolvePage(pageId: number) {
  const [page] = await db
    .select({ id: pages.id, projectId: pages.projectId, url: pages.url, title: pages.title })
    .from(pages)
    .where(eq(pages.id, pageId))
    .limit(1);
  return page ?? null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureDb();
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const pageId = parsePositiveInt(id);
  if (!pageId) {
    return NextResponse.json({ error: 'Invalid page id' }, { status: 400 });
  }

  if (!(await userCanAccessPage(user, pageId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const page = await resolvePage(pageId);
  if (!page) return NextResponse.json({ error: 'Page not found' }, { status: 404 });

  const search = String(req.nextUrl.searchParams.get('search') || '').trim();
  const keywordLimit = Math.max(20, Math.min(parsePositiveInt(req.nextUrl.searchParams.get('limit')) ?? 300, 1000));

  const [mappings, availableKeywords] = await Promise.all([
    db
      .select({
        id: pageKeywordMappings.id,
        keywordId: pageKeywordMappings.keywordId,
        mappingType: pageKeywordMappings.mappingType,
        clusterKey: pageKeywordMappings.clusterKey,
        keyword: keywords.keyword,
        status: keywords.status,
        volume: keywords.volume,
        difficulty: keywords.difficulty,
      })
      .from(pageKeywordMappings)
      .innerJoin(keywords, eq(keywords.id, pageKeywordMappings.keywordId))
      .where(and(eq(pageKeywordMappings.projectId, page.projectId), eq(pageKeywordMappings.pageId, page.id)))
      .orderBy(pageKeywordMappings.mappingType, asc(keywords.keyword)),
    db
      .select({
        id: keywords.id,
        keyword: keywords.keyword,
        status: keywords.status,
        volume: keywords.volume,
        difficulty: keywords.difficulty,
      })
      .from(keywords)
      .where(
        and(
          eq(keywords.projectId, page.projectId),
          ...(search
            ? [sql`LOWER(${keywords.keyword}) LIKE ${`%${search.toLowerCase()}%`}`]
            : [])
        )
      )
      .orderBy(desc(keywords.volume), asc(keywords.keyword))
      .limit(keywordLimit),
  ]);

  const primaryKeywordId =
    mappings.find((row: (typeof mappings)[number]) => row.mappingType === 'primary')?.keywordId ?? null;

  return NextResponse.json({
    page,
    primaryKeywordId,
    mappings: mappings.map((row: (typeof mappings)[number]) => ({
      id: Number(row.id),
      keywordId: Number(row.keywordId),
      mappingType: row.mappingType === 'primary' ? 'primary' : 'secondary',
      clusterKey: row.clusterKey ? String(row.clusterKey) : null,
      keyword: String(row.keyword),
      status: String(row.status || 'new'),
      volume: row.volume === null || row.volume === undefined ? null : Number(row.volume),
      difficulty: row.difficulty === null || row.difficulty === undefined ? null : Number(row.difficulty),
    })),
    availableKeywords: availableKeywords.map((row: (typeof availableKeywords)[number]) => ({
      id: Number(row.id),
      keyword: String(row.keyword),
      status: String(row.status || 'new'),
      volume: row.volume === null || row.volume === undefined ? null : Number(row.volume),
      difficulty: row.difficulty === null || row.difficulty === undefined ? null : Number(row.difficulty),
    })),
  });
}

export async function PUT(
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

  const page = await resolvePage(pageId);
  if (!page) return NextResponse.json({ error: 'Page not found' }, { status: 404 });

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const primaryKeywordId = parsePositiveInt(String(body.primaryKeywordId ?? ''));
  const secondaryKeywordIds = normalizeKeywordIds(body.secondaryKeywordIds);

  if (!primaryKeywordId) {
    return NextResponse.json(
      { error: 'A primary keyword is required for page optimization.' },
      { status: 400 }
    );
  }

  const allKeywordIds = Array.from(
    new Set([...(primaryKeywordId ? [primaryKeywordId] : []), ...secondaryKeywordIds])
  );

  const validKeywords = allKeywordIds.length
    ? await db
        .select({ id: keywords.id })
        .from(keywords)
        .where(and(eq(keywords.projectId, page.projectId), inArray(keywords.id, allKeywordIds)))
    : [];

  const validKeywordIdSet = new Set(validKeywords.map((row: (typeof validKeywords)[number]) => Number(row.id)));
  if (allKeywordIds.some((idValue) => !validKeywordIdSet.has(idValue))) {
    return NextResponse.json(
      { error: 'One or more keywords are not in this project scope.' },
      { status: 400 }
    );
  }

  const primaryInUse = await db
    .select({
      pageId: pageKeywordMappings.pageId,
      pageUrl: pages.url,
      pageTitle: pages.title,
    })
    .from(pageKeywordMappings)
    .innerJoin(pages, eq(pages.id, pageKeywordMappings.pageId))
    .where(
      and(
        eq(pageKeywordMappings.projectId, page.projectId),
        eq(pageKeywordMappings.keywordId, primaryKeywordId),
        eq(pageKeywordMappings.mappingType, 'primary'),
        ne(pageKeywordMappings.pageId, page.id)
      )
    )
    .limit(1);

  if (primaryInUse.length > 0) {
    const conflict = primaryInUse[0];
    return NextResponse.json(
      {
        error: 'Primary keyword is already mapped to another page.',
        conflict: {
          pageId: Number(conflict.pageId),
          url: String(conflict.pageUrl),
          title: conflict.pageTitle ? String(conflict.pageTitle) : null,
        },
      },
      { status: 409 }
    );
  }

  const now = dbNow();

  const previousMappings = await db
    .select({
      keywordId: pageKeywordMappings.keywordId,
      mappingType: pageKeywordMappings.mappingType,
    })
    .from(pageKeywordMappings)
    .where(and(eq(pageKeywordMappings.projectId, page.projectId), eq(pageKeywordMappings.pageId, page.id)));

  const previousPrimaryKeywordId =
    previousMappings.find((row: (typeof previousMappings)[number]) => row.mappingType === 'primary')
      ?.keywordId ?? null;
  const previousSecondaryKeywordIds = previousMappings
    .filter((row: (typeof previousMappings)[number]) => row.mappingType !== 'primary')
    .map((row: (typeof previousMappings)[number]) => Number(row.keywordId));

  await db.delete(pageKeywordMappings).where(eq(pageKeywordMappings.pageId, page.id));

  if (primaryKeywordId) {
    await db.insert(pageKeywordMappings).values({
      projectId: page.projectId,
      pageId: page.id,
      keywordId: primaryKeywordId,
      mappingType: 'primary',
      clusterKey: null,
      createdAt: now,
      updatedAt: now,
    });

    await db
      .update(keywords)
      .set({
        targetUrl: page.url,
        updatedAt: now,
      })
      .where(eq(keywords.id, primaryKeywordId));
  }

  const cleanSecondary = secondaryKeywordIds.filter((keywordId) => keywordId !== primaryKeywordId);
  for (const keywordId of cleanSecondary) {
    await db.insert(pageKeywordMappings).values({
      projectId: page.projectId,
      pageId: page.id,
      keywordId,
      mappingType: 'secondary',
      clusterKey: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  const mappings = await db
    .select({
      keywordId: pageKeywordMappings.keywordId,
      mappingType: pageKeywordMappings.mappingType,
      keyword: keywords.keyword,
      volume: keywords.volume,
      difficulty: keywords.difficulty,
    })
    .from(pageKeywordMappings)
    .innerJoin(keywords, eq(keywords.id, pageKeywordMappings.keywordId))
    .where(and(eq(pageKeywordMappings.projectId, page.projectId), eq(pageKeywordMappings.pageId, page.id)))
    .orderBy(pageKeywordMappings.mappingType, asc(keywords.keyword));

  await logAuditEvent({
    userId: auth.user.id,
    action: 'page.keyword_mapping.update',
    resourceType: 'page',
    resourceId: page.id,
    projectId: page.projectId,
    metadata: {
      primaryKeywordId,
      secondaryKeywordCount: secondaryKeywordIds.length,
      hasPrimary: Boolean(primaryKeywordId),
      previousPrimaryKeywordId,
      previousSecondaryKeywordIds,
      newSecondaryKeywordIds: cleanSecondary,
    },
  });

  return NextResponse.json({
    success: true,
    pageId: page.id,
    projectId: page.projectId,
    primaryKeywordId,
    mappings: mappings.map((row: (typeof mappings)[number]) => ({
      keywordId: Number(row.keywordId),
      mappingType: row.mappingType === 'primary' ? 'primary' : 'secondary',
      keyword: String(row.keyword),
      volume: row.volume === null || row.volume === undefined ? null : Number(row.volume),
      difficulty: row.difficulty === null || row.difficulty === undefined ? null : Number(row.difficulty),
    })),
    governance: {
      primaryRequired: true,
      primaryUniquePerProject: true,
    },
  });
}
