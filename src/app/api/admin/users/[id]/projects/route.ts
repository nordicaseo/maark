import { NextRequest, NextResponse } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';
import { db, ensureDb } from '@/db';
import { projectMembers, projects, users } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { isAdminUser } from '@/lib/access';
import { PROJECT_ASSIGNABLE_ROLES } from '@/lib/permissions';
import { logAuditEvent } from '@/lib/observability';

type ProjectAssignmentRole = (typeof PROJECT_ASSIGNABLE_ROLES)[number];
type ManageableProject = { projectId: number; projectName: string };
type ProjectAccessEntry = {
  projectId: number;
  projectName: string;
  assigned: boolean;
  assignedRole: string | null;
};
type ExistingMembership = { id: number; projectId: number; role: unknown };

function parseProjectId(value: unknown): number | null {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeAssignments(value: unknown): Array<{ projectId: number; role: ProjectAssignmentRole }> {
  if (!Array.isArray(value)) return [];
  const seen = new Set<number>();
  const assignments: Array<{ projectId: number; role: ProjectAssignmentRole }> = [];

  for (const rawItem of value) {
    if (!rawItem || typeof rawItem !== 'object') continue;
    const item = rawItem as { projectId?: unknown; role?: unknown };
    const projectId = parseProjectId(item.projectId);
    if (!projectId || seen.has(projectId)) continue;
    const role = String(item.role ?? 'writer');
    if (!PROJECT_ASSIGNABLE_ROLES.includes(role as ProjectAssignmentRole)) continue;
    assignments.push({ projectId, role: role as ProjectAssignmentRole });
    seen.add(projectId);
  }

  return assignments;
}

async function listManageableProjects(
  userId: string,
  isRoot: boolean
): Promise<ManageableProject[]> {
  if (isRoot) {
    const allProjects = await db
      .select({
        projectId: projects.id,
        projectName: projects.name,
      })
      .from(projects);
    return allProjects;
  }

  const manageableRows = await db
    .select({
      projectId: projectMembers.projectId,
      projectName: projects.name,
    })
    .from(projectMembers)
    .innerJoin(projects, eq(projectMembers.projectId, projects.id))
    .where(
      and(
        eq(projectMembers.userId, userId),
        eq(projectMembers.role, 'admin')
      )
    );

  return manageableRows;
}

async function listProjectAccessForUser(
  targetUserId: string,
  manageableProjectIds: number[]
): Promise<ProjectAccessEntry[]> {
  if (manageableProjectIds.length === 0) return [];

  const [membershipRows, projectRows] = await Promise.all([
    db
      .select({
        projectId: projectMembers.projectId,
        role: projectMembers.role,
      })
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.userId, targetUserId),
          inArray(projectMembers.projectId, manageableProjectIds)
        )
      ),
    db
      .select({
        projectId: projects.id,
        projectName: projects.name,
      })
      .from(projects)
      .where(inArray(projects.id, manageableProjectIds)),
  ]);

  const roleByProject = new Map<number, string>(
    membershipRows.map((row: { projectId: number; role: unknown }) => [row.projectId, String(row.role)])
  );

  return projectRows
    .map((project: ManageableProject) => ({
      projectId: project.projectId,
      projectName: project.projectName,
      assigned: roleByProject.has(project.projectId),
      assignedRole: (roleByProject.get(project.projectId) || null) as string | null,
    }))
    .sort(
      (a: ProjectAccessEntry, b: ProjectAccessEntry) =>
        a.projectName.localeCompare(b.projectName)
    );
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureDb();
  const auth = await requireRole('admin');
  if (auth.error) return auth.error;

  const { id: targetUserId } = await params;
  const [targetUser] = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, targetUserId))
    .limit(1);

  if (!targetUser) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const manageableProjects = await listManageableProjects(
    auth.user.id,
    isAdminUser(auth.user)
  );
  const manageableProjectIds = manageableProjects.map(
    (project: ManageableProject) => project.projectId
  );
  const projectAccess = await listProjectAccessForUser(targetUserId, manageableProjectIds);

  return NextResponse.json({
    userId: targetUser.id,
    userEmail: targetUser.email,
    userName: targetUser.name,
    projects: projectAccess,
  });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureDb();
  const auth = await requireRole('admin');
  if (auth.error) return auth.error;

  const { id: targetUserId } = await params;
  const [targetUser] = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, targetUserId))
    .limit(1);

  if (!targetUser) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const assignments = normalizeAssignments((body as { assignments?: unknown }).assignments);
  const assignmentProjectIds = assignments.map((assignment) => assignment.projectId);

  const manageableProjects = await listManageableProjects(
    auth.user.id,
    isAdminUser(auth.user)
  );
  const manageableProjectIds = manageableProjects.map(
    (project: ManageableProject) => project.projectId
  );
  const manageableProjectSet = new Set(manageableProjectIds);

  for (const assignment of assignments) {
    if (!manageableProjectSet.has(assignment.projectId)) {
      return NextResponse.json(
        { error: `Forbidden project scope for projectId ${assignment.projectId}` },
        { status: 403 }
      );
    }
  }

  if (manageableProjectIds.length > 0) {
    const existingMemberships = await db
      .select({
        id: projectMembers.id,
        projectId: projectMembers.projectId,
        role: projectMembers.role,
      })
      .from(projectMembers)
      .where(
        and(
          eq(projectMembers.userId, targetUserId),
          inArray(projectMembers.projectId, manageableProjectIds)
        )
      );

    const existingByProject = new Map<number, ExistingMembership>(
      existingMemberships.map((membership: ExistingMembership) => [
        membership.projectId,
        membership,
      ])
    );
    const assignmentByProject = new Map<number, ProjectAssignmentRole>(
      assignments.map((assignment: { projectId: number; role: ProjectAssignmentRole }) => [
        assignment.projectId,
        assignment.role,
      ])
    );

    for (const [projectId, role] of assignmentByProject.entries()) {
      const existing = existingByProject.get(projectId);
      if (!existing) {
        await db.insert(projectMembers).values({
          projectId,
          userId: targetUserId,
          role,
        });
        continue;
      }
      if (String(existing.role) !== role) {
        await db
          .update(projectMembers)
          .set({ role })
          .where(eq(projectMembers.id, existing.id));
      }
    }

    for (const existing of existingMemberships as ExistingMembership[]) {
      if (assignmentByProject.has(existing.projectId)) continue;
      await db
        .delete(projectMembers)
        .where(eq(projectMembers.id, existing.id));
    }
  }

  const updatedProjectAccess = await listProjectAccessForUser(targetUserId, manageableProjectIds);

  await logAuditEvent({
    userId: auth.user.id,
    action: 'admin.user.project_access.update',
    resourceType: 'user',
    resourceId: targetUserId,
    severity: 'warning',
    metadata: {
      assignments: assignments.map((assignment) => ({
        projectId: assignment.projectId,
        role: assignment.role,
      })),
      assignmentProjectIds,
    },
  });

  return NextResponse.json({
    userId: targetUser.id,
    projects: updatedProjectAccess,
  });
}
