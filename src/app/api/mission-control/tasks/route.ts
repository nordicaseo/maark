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

const PER_PROJECT_LIMIT = 400;
const TOTAL_LIMIT = 1400;
type ProjectRow = { id: number; name: string };
type TaskLike = {
  workflowLastEventAt?: number | null;
  updatedAt?: number | null;
};

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

  const requestedProjectId = getRequestedProjectId(req);
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
        limit: PER_PROJECT_LIMIT,
      })
    )
  );

  const tasks = (taskChunks
    .flat()
    .sort(
      (a: TaskLike, b: TaskLike) =>
        (b.workflowLastEventAt || b.updatedAt || 0) - (a.workflowLastEventAt || a.updatedAt || 0)
    )
    .slice(0, TOTAL_LIMIT));

  return NextResponse.json({
    tasks,
    projects: projectRows,
  });
}
