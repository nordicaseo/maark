import { NextRequest, NextResponse } from 'next/server';
import { inArray } from 'drizzle-orm';
import { api } from '../../../../../convex/_generated/api';
import { db, ensureDb } from '@/db';
import { projects } from '@/db/schema';
import { getAuthUser } from '@/lib/auth';
import {
  getAccessibleProjectIds,
  getRequestedProjectId,
  isAdminUser,
  userCanAccessProject,
} from '@/lib/access';
import { getConvexClient } from '@/lib/convex/server';
import { TASK_STATUS_ORDER, type TaskStatus } from '@/lib/content-workflow-taxonomy';

const DEFAULT_LIMIT = 300;
const MAX_LIMIT = 700;
const MIN_LIMIT = 40;
const MAX_PER_PROJECT_LIMIT = 220;
type ProjectRow = { id: number; name: string };
type TaskLike = {
  status?: string;
  projectId?: number | null;
  workflowLastEventAt?: number | null;
  updatedAt?: number | null;
};

function parsePositiveInt(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function parseStatusFilter(raw: string | null): Set<TaskStatus> {
  if (!raw) return new Set<TaskStatus>();
  const valid = new Set<TaskStatus>(TASK_STATUS_ORDER);
  const parsed = raw
    .split(',')
    .map((item) => item.trim().toUpperCase())
    .filter((item): item is TaskStatus => valid.has(item as TaskStatus));
  return new Set(parsed);
}

export async function GET(req: NextRequest) {
  await ensureDb();
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const convex = getConvexClient();
  if (!convex) {
    return NextResponse.json(
      { error: 'Mission Control is not configured (Convex URL missing)' },
      { status: 500 }
    );
  }

  const queryProjectId = parsePositiveInt(req.nextUrl.searchParams.get('projectId'));
  const requestedProjectId = queryProjectId ?? getRequestedProjectId(req);
  const requestedLimit = parsePositiveInt(req.nextUrl.searchParams.get('limit')) ?? DEFAULT_LIMIT;
  const limit = clamp(requestedLimit, MIN_LIMIT, MAX_LIMIT);
  const cursorTs = parsePositiveInt(req.nextUrl.searchParams.get('cursor'));
  const statusFilter = parseStatusFilter(req.nextUrl.searchParams.get('status'));
  let projectIds: number[] = [];

  if (requestedProjectId !== null) {
    if (!(await userCanAccessProject(user, requestedProjectId))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    projectIds = [requestedProjectId];
  } else if (isAdminUser(user)) {
    const allProjects = await db.select({ id: projects.id }).from(projects);
    projectIds = allProjects.map((project: { id: number }) => project.id);
  } else {
    projectIds = await getAccessibleProjectIds(user);
  }

  if (projectIds.length === 0) {
    return NextResponse.json({ tasks: [], projects: [] });
  }

  const projectRows = (await db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(inArray(projects.id, projectIds))) as ProjectRow[];

  const taskChunks = await Promise.all(
    projectIds.map((projectId) =>
      convex.query(api.tasks.list, {
        projectId,
        limit: Math.min(MAX_PER_PROJECT_LIMIT, limit),
      })
    )
  );

  const tasks = (taskChunks
    .flat()
    .filter((task: TaskLike) => {
      const eventAt = task.workflowLastEventAt || task.updatedAt || 0;
      if (cursorTs && eventAt >= cursorTs) return false;
      if (statusFilter.size > 0 && task.status) {
        return statusFilter.has(task.status as TaskStatus);
      }
      return true;
    })
    .sort(
      (a: TaskLike, b: TaskLike) =>
        (b.workflowLastEventAt || b.updatedAt || 0) - (a.workflowLastEventAt || a.updatedAt || 0)
    )
    .slice(0, limit));

  const nextCursor =
    tasks.length === limit
      ? String(tasks[tasks.length - 1].workflowLastEventAt || tasks[tasks.length - 1].updatedAt || 0)
      : null;

  return NextResponse.json({
    tasks,
    projects: projectRows,
    nextCursor,
  });
}
