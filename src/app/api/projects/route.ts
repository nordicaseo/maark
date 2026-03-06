import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/db/index';
import { projects, projectMembers, sites } from '@/db/schema';
import { desc, eq, sql } from 'drizzle-orm';
import { getAuthUser, requireRole } from '@/lib/auth';
import { isAdminUser } from '@/lib/access';
import { dbNow } from '@/db/utils';
import { runDiscoveryForProject } from '@/lib/discovery/discovery-runner';
import { enqueueProjectPagesForCrawl, processDueCrawlJobs } from '@/lib/discovery/crawl-queue';

export async function GET(req: NextRequest) {
  await ensureDb();
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const userId = req.nextUrl.searchParams.get('userId');

  try {
    if (userId && !isAdminUser(user) && userId !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const selectQuery = db
      .select({
        id: projects.id,
        name: projects.name,
        description: projects.description,
        defaultContentFormat: projects.defaultContentFormat,
        brandVoice: projects.brandVoice,
        settings: projects.settings,
        createdById: projects.createdById,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
        memberCount: sql<number>`(SELECT COUNT(*) FROM project_members WHERE project_id = ${projects.id})`,
      })
      .from(projects)
      .orderBy(desc(projects.updatedAt));

    if (isAdminUser(user) && !userId) {
      return NextResponse.json(await selectQuery);
    }

    const targetUserId = userId && isAdminUser(user) ? userId : user.id;
    const memberRows = await db
      .select({ projectId: projectMembers.projectId })
      .from(projectMembers)
      .where(eq(projectMembers.userId, targetUserId));

    const projectIds = memberRows.map((r: { projectId: number }) => r.projectId);
    if (projectIds.length === 0) {
      return NextResponse.json([]);
    }

    const results = await db
      .select({
        id: projects.id,
        name: projects.name,
        description: projects.description,
        defaultContentFormat: projects.defaultContentFormat,
        brandVoice: projects.brandVoice,
        settings: projects.settings,
        createdById: projects.createdById,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
        memberCount: sql<number>`(SELECT COUNT(*) FROM project_members WHERE project_id = ${projects.id})`,
      })
      .from(projects)
      .where(
        sql`${projects.id} IN (${sql.join(
          projectIds.map((id: number) => sql`${id}`),
          sql`, `
        )})`
      )
      .orderBy(desc(projects.updatedAt));

    return NextResponse.json(results);
  } catch (error) {
    console.error('Error fetching projects:', error);
    return NextResponse.json([], { status: 200 });
  }
}

export async function POST(req: NextRequest) {
  await ensureDb();
  const auth = await requireRole('admin');
  if (auth.error) return auth.error;
  try {
    const body = await req.json();
    const {
      name,
      description,
      defaultContentFormat,
      brandVoice,
      createdById,
      domain,
      sitemapUrl,
      gscProperty,
      autoCrawlEnabled,
      autoGscEnabled,
      crawlFrequencyHours,
    } = body;

    if (!name) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }
    if (!domain || typeof domain !== 'string' || !domain.trim()) {
      return NextResponse.json({ error: 'Domain is required for crawl bootstrap' }, { status: 400 });
    }

    const normalizedDomain = String(domain).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '').split('/')[0];
    if (!normalizedDomain) {
      return NextResponse.json({ error: 'Invalid domain' }, { status: 400 });
    }

    const normalizedSitemapUrl =
      typeof sitemapUrl === 'string' && sitemapUrl.trim()
        ? sitemapUrl.trim()
        : `https://${normalizedDomain}/sitemap.xml`;
    const normalizedGscProperty =
      typeof gscProperty === 'string' && gscProperty.trim()
        ? gscProperty.trim()
        : null;
    const normalizedAutoCrawlEnabled = autoCrawlEnabled === false ? 0 : 1;
    const normalizedAutoGscEnabled = autoGscEnabled === false ? 0 : 1;
    const normalizedCrawlFrequency = Math.max(
      1,
      Math.min(168, Number.parseInt(String(crawlFrequencyHours ?? 24), 10) || 24)
    );

    const [project] = await db
      .insert(projects)
      .values({
        name,
        description: description || null,
        defaultContentFormat: defaultContentFormat || 'blog_post',
        brandVoice: brandVoice || null,
        createdById: createdById || null,
      })
      .returning();

    const now = dbNow();
    const [site] = await db
      .insert(sites)
      .values({
        projectId: project.id,
        domain: normalizedDomain,
        sitemapUrl: normalizedSitemapUrl,
        gscProperty: normalizedGscProperty,
        gscConnectedAt: normalizedGscProperty ? now : null,
        autoCrawlEnabled: normalizedAutoCrawlEnabled,
        autoGscEnabled: normalizedAutoGscEnabled,
        crawlFrequencyHours: normalizedCrawlFrequency,
        isPrimary: 1,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    let bootstrap:
      | {
          discovery: { discovered: number; candidates: number; excluded: number; warnings: number };
          enqueue: { enqueued: number; reused: number; discoveredPages: number };
          worker: { processedCount: number };
        }
      | null = null;

    try {
      const discovery = await runDiscoveryForProject({
        projectId: project.id,
        sitemapUrl: normalizedSitemapUrl,
        gscProperty: normalizedGscProperty,
        includeInventory: true,
        gscTopPagesLimit: 2000,
      });
      const enqueue = await enqueueProjectPagesForCrawl({
        projectId: project.id,
        limit: 25,
        runType: 'bootstrap',
      });
      const worker = await processDueCrawlJobs({
        projectId: project.id,
        limit: 8,
      });

      bootstrap = {
        discovery: {
          discovered: discovery.totals.discovered,
          candidates: discovery.totals.candidates,
          excluded: discovery.totals.excluded,
          warnings: discovery.warnings.length,
        },
        enqueue: {
          enqueued: enqueue.enqueued,
          reused: enqueue.reused,
          discoveredPages: enqueue.discoveredPages,
        },
        worker: {
          processedCount: worker.processedCount,
        },
      };
    } catch (error) {
      console.error('Project crawl bootstrap failed:', error);
    }

    return NextResponse.json({
      ...project,
      site,
      bootstrap,
    });
  } catch (error) {
    console.error('Error creating project:', error);
    return NextResponse.json(
      { error: 'Failed to create project' },
      { status: 500 }
    );
  }
}
