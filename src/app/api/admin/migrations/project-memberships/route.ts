import { NextRequest, NextResponse } from 'next/server';
import { and, eq, notInArray, sql } from 'drizzle-orm';
import { db, ensureDb } from '@/db';
import { projectMembers, users } from '@/db/schema';
import { requireRole } from '@/lib/auth';
import { PROJECT_ASSIGNABLE_ROLES } from '@/lib/permissions';
import { logAuditEvent } from '@/lib/observability';

function sanitizeProjectIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const unique = new Set<number>();
  for (const value of raw) {
    const parsed = Number.parseInt(String(value), 10);
    if (Number.isFinite(parsed) && parsed > 0) unique.add(parsed);
  }
  return Array.from(unique);
}

export async function GET() {
  await ensureDb();
  const auth = await requireRole('super_admin');
  if (auth.error) return auth.error;

  const missingMembershipUsers = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      membershipCount: sql<number>`CAST(COUNT(${projectMembers.id}) AS INTEGER)`,
    })
    .from(users)
    .leftJoin(projectMembers, eq(projectMembers.userId, users.id))
    .where(notInArray(users.role, ['owner', 'super_admin']))
    .groupBy(users.id)
    .having(sql`COUNT(${projectMembers.id}) = 0`);

  return NextResponse.json({ users: missingMembershipUsers });
}

export async function POST(req: NextRequest) {
  await ensureDb();
  const auth = await requireRole('super_admin');
  if (auth.error) return auth.error;

  try {
    const body = await req.json();
    const assignments = Array.isArray(body.assignments) ? body.assignments : [];
    if (assignments.length === 0) {
      return NextResponse.json({ error: 'assignments is required' }, { status: 400 });
    }

    let granted = 0;

    for (const assignment of assignments) {
      const userId = typeof assignment.userId === 'string' ? assignment.userId : '';
      const projectIds = sanitizeProjectIds(assignment.projectIds);
      const roleRaw = typeof assignment.role === 'string' ? assignment.role : 'writer';
      const role = PROJECT_ASSIGNABLE_ROLES.includes(
        roleRaw as (typeof PROJECT_ASSIGNABLE_ROLES)[number]
      )
        ? roleRaw
        : 'writer';

      if (!userId || projectIds.length === 0) continue;

      for (const projectId of projectIds) {
        const [existingMembership] = await db
          .select({ id: projectMembers.id })
          .from(projectMembers)
          .where(
            and(
              eq(projectMembers.projectId, projectId),
              eq(projectMembers.userId, userId)
            )
          )
          .limit(1);
        if (existingMembership) continue;
        await db.insert(projectMembers).values({
          projectId,
          userId,
          role,
        });
        granted += 1;
      }
    }

    await logAuditEvent({
      userId: auth.user.id,
      action: 'admin.migration.project_membership_backfill',
      resourceType: 'project_member',
      resourceId: 'bulk',
      severity: 'warning',
      metadata: { granted },
    });

    return NextResponse.json({ ok: true, granted });
  } catch (error) {
    console.error('Project membership backfill failed:', error);
    return NextResponse.json(
      { error: 'Failed to run membership backfill' },
      { status: 500 }
    );
  }
}
