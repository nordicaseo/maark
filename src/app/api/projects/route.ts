import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/db/index';
import { projects, projectMembers, sites } from '@/db/schema';
import { desc, eq, sql } from 'drizzle-orm';
import { getAuthUser, requireRole } from '@/lib/auth';
import { isAdminUser } from '@/lib/access';
import { dbNow } from '@/db/utils';
import { runDiscoveryForProject } from '@/lib/discovery/discovery-runner';
import { enqueueProjectPagesForCrawl, processDueCrawlJobs } from '@/lib/discovery/crawl-queue';
import { processDuePageArtifactJobs } from '@/lib/discovery/page-artifact-queue';
import { logAuditEvent } from '@/lib/observability';
import { seedProjectAgentProfiles } from '@/lib/agents/project-agent-profiles';
import {
  buildRoleCounts,
  syncProjectDedicatedAgentPool,
} from '@/lib/agents/runtime-agent-pools';
import type {
  AgentRoleCounts,
  ProjectLaneCapacitySettings,
  AgentStaffingTemplate,
  ProjectBootstrapStage,
  ProjectBootstrapStageState,
} from '@/types/agent-runtime';
import { DEFAULT_LANE_CAPACITY_SETTINGS } from '@/types/agent-runtime';

const BOOTSTRAP_STAGE_LABELS: Record<ProjectBootstrapStage, string> = {
  seeding_agents: 'Seeding Agents',
  creating_mission_control: 'Creating Mission Control',
  fetching_pages: 'Fetching Pages',
  connect_gsc: 'Connect your GSC',
};

function normalizeStaffingTemplate(input: unknown): AgentStaffingTemplate {
  const value = String(input ?? '')
    .trim()
    .toLowerCase();
  if (value === 'small' || value === 'standard' || value === 'premium') return value;
  return 'small';
}

function parseAgentRoleCounts(input: unknown): AgentRoleCounts {
  if (!input || typeof input !== 'object') return {};
  const source = input as Record<string, unknown>;
  const out: AgentRoleCounts = {};
  for (const role of [
    'researcher',
    'outliner',
    'writer',
    'seo-reviewer',
    'project-manager',
    'seo',
    'content',
    'lead',
  ] as const) {
    const raw = source[role];
    if (raw === undefined || raw === null) continue;
    const count = Math.max(1, Math.min(10, Number.parseInt(String(raw), 10) || 1));
    out[role] = count;
  }
  return out;
}

function parseLaneCapacity(input: unknown): ProjectLaneCapacitySettings {
  const source = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const minWritersPerLane = Math.max(
    1,
    Math.min(
      5,
      Number.parseInt(
        String(source.minWritersPerLane ?? DEFAULT_LANE_CAPACITY_SETTINGS.minWritersPerLane),
        10
      ) || DEFAULT_LANE_CAPACITY_SETTINGS.minWritersPerLane
    )
  );
  const maxCandidate =
    Number.parseInt(
      String(source.maxWritersPerLane ?? DEFAULT_LANE_CAPACITY_SETTINGS.maxWritersPerLane),
      10
    ) || DEFAULT_LANE_CAPACITY_SETTINGS.maxWritersPerLane;
  const maxWritersPerLane = Math.max(minWritersPerLane, Math.min(8, maxCandidate));
  const scaleUpQueueAgeSec = Math.max(
    30,
    Math.min(
      3600,
      Number.parseInt(
        String(source.scaleUpQueueAgeSec ?? DEFAULT_LANE_CAPACITY_SETTINGS.scaleUpQueueAgeSec),
        10
      ) || DEFAULT_LANE_CAPACITY_SETTINGS.scaleUpQueueAgeSec
    )
  );
  const scaleDownIdleSec = Math.max(
    300,
    Math.min(
      86400,
      Number.parseInt(
        String(source.scaleDownIdleSec ?? DEFAULT_LANE_CAPACITY_SETTINGS.scaleDownIdleSec),
        10
      ) || DEFAULT_LANE_CAPACITY_SETTINGS.scaleDownIdleSec
    )
  );
  return {
    minWritersPerLane,
    maxWritersPerLane,
    scaleUpQueueAgeSec,
    scaleDownIdleSec,
  };
}

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
      agentStaffingTemplate,
      agentRoleCounts,
      laneCapacity,
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
    const normalizedStaffingTemplate = normalizeStaffingTemplate(agentStaffingTemplate);
    const normalizedRoleCounts = parseAgentRoleCounts(agentRoleCounts);
    const normalizedLaneCapacity = parseLaneCapacity(laneCapacity);
    const resolvedRoleCounts = buildRoleCounts(normalizedStaffingTemplate, normalizedRoleCounts);
    const normalizedCrawlFrequency = Math.max(
      1,
      Math.min(168, Number.parseInt(String(crawlFrequencyHours ?? 24), 10) || 24)
    );

    const projectSettings =
      body.settings && typeof body.settings === 'object'
        ? (body.settings as Record<string, unknown>)
        : {};
    projectSettings.agentRuntime = {
      staffingTemplate: normalizedStaffingTemplate,
      roleCounts: resolvedRoleCounts,
      strictIsolation: true,
      laneCapacity: normalizedLaneCapacity,
    };

    const [project] = await db
      .insert(projects)
      .values({
        name,
        description: description || null,
        defaultContentFormat: defaultContentFormat || 'blog_post',
        brandVoice: brandVoice || null,
        settings: projectSettings,
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

    const bootstrapStages: ProjectBootstrapStageState[] = [
      {
        stage: 'seeding_agents',
        label: BOOTSTRAP_STAGE_LABELS.seeding_agents,
        status: 'pending',
      },
      {
        stage: 'creating_mission_control',
        label: BOOTSTRAP_STAGE_LABELS.creating_mission_control,
        status: 'pending',
      },
      {
        stage: 'fetching_pages',
        label: BOOTSTRAP_STAGE_LABELS.fetching_pages,
        status: 'pending',
      },
      {
        stage: 'connect_gsc',
        label: BOOTSTRAP_STAGE_LABELS.connect_gsc,
        status: normalizedGscProperty ? 'done' : 'pending',
        message: normalizedGscProperty
          ? 'GSC property provided during setup.'
          : 'Connect Google Search Console to unlock richer data.',
      },
    ];

    const setBootstrapStage = async (
      stage: ProjectBootstrapStage,
      status: ProjectBootstrapStageState['status'],
      message?: string
    ) => {
      const idx = bootstrapStages.findIndex((entry) => entry.stage === stage);
      if (idx >= 0) {
        bootstrapStages[idx] = {
          ...bootstrapStages[idx],
          status,
          message: message ?? null,
          updatedAt: new Date().toISOString(),
        };
      }
      await logAuditEvent({
        userId: auth.user.id,
        action: 'project.bootstrap.stage',
        resourceType: 'project',
        resourceId: project.id,
        projectId: project.id,
        metadata: {
          stage,
          status,
          message: message ?? null,
          stages: bootstrapStages,
        },
      });
    };

    let bootstrap:
      | {
          agents: {
            seededProfiles: number;
            runtimeCreated: number;
            runtimeUpdated: number;
          };
          discovery: { discovered: number; candidates: number; excluded: number; warnings: number };
          enqueue: { enqueued: number; reused: number; discoveredPages: number };
          worker: { processedCount: number };
          artifactWorker: { processedCount: number };
        }
      | null = null;

    try {
      await setBootstrapStage('seeding_agents', 'running', 'Creating project-specific agent profiles...');
      const seeded = await seedProjectAgentProfiles(project.id, auth.user.id);
      await setBootstrapStage('seeding_agents', 'done', 'Agent profiles ready.');

      await setBootstrapStage(
        'creating_mission_control',
        'running',
        `Allocating ${normalizedStaffingTemplate} dedicated team...`
      );
      const runtimeSync = await syncProjectDedicatedAgentPool({
        projectId: project.id,
        template: normalizedStaffingTemplate,
        roleCounts: resolvedRoleCounts,
        laneCapacity: normalizedLaneCapacity,
      });
      await setBootstrapStage('creating_mission_control', 'done', 'Dedicated Mission Control team ready.');

      await setBootstrapStage('fetching_pages', 'running', 'Running discovery and initial crawl bootstrap...');
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
      const artifactWorker = await processDuePageArtifactJobs({
        projectId: project.id,
        limit: 16,
      });
      await setBootstrapStage('fetching_pages', 'done', 'Pages discovered and initial crawl completed.');

      bootstrap = {
        agents: {
          seededProfiles: seeded.seededRoles.length,
          runtimeCreated: runtimeSync.created,
          runtimeUpdated: runtimeSync.updated,
        },
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
        artifactWorker: {
          processedCount: artifactWorker.processedCount,
        },
      };
    } catch (error) {
      console.error('Project crawl bootstrap failed:', error);
      const detail = error instanceof Error ? error.message : 'Unknown bootstrap error';
      const firstPending = bootstrapStages.find((stage) => stage.status === 'running');
      if (firstPending) {
        await setBootstrapStage(firstPending.stage, 'failed', detail);
      }
    }

    await logAuditEvent({
      userId: auth.user.id,
      action: 'project.bootstrap.completed',
      resourceType: 'project',
      resourceId: project.id,
      projectId: project.id,
      severity: bootstrapStages.some((stage) => stage.status === 'failed') ? 'warning' : 'info',
      metadata: {
        stages: bootstrapStages,
      },
    });

    return NextResponse.json({
      ...project,
      site,
      bootstrapStages,
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
