import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/db';
import { projectMembers, userPresence, users } from '@/db/schema';
import { getAuthUser } from '@/lib/auth';
import {
  getAccessibleProjectIds,
  getRequestedProjectId,
  isAdminUser,
  userCanAccessProject,
} from '@/lib/access';
import { eq, inArray } from 'drizzle-orm';

const ONLINE_STALE_THRESHOLD_MS = 95 * 1000;

function enrichWithPresence<T extends { id: string }>(
  rows: T[],
  presenceRows: Array<{
    userId: string;
    lastSeenAt: string | null;
    onlineSeconds: number | null;
    activeSeconds: number | null;
    heartbeatCount: number | null;
  }>
) {
  const now = Date.now();
  const map = new Map(presenceRows.map((row) => [row.userId, row]));
  return rows.map((row) => {
    const presence = map.get(row.id);
    const lastSeenAt = presence?.lastSeenAt || null;
    const lastSeenMs = lastSeenAt ? new Date(lastSeenAt).getTime() : 0;
    const isOnline = Boolean(lastSeenMs && now - lastSeenMs <= ONLINE_STALE_THRESHOLD_MS);
    const onlineSeconds = Number(presence?.onlineSeconds || 0);
    const activeSeconds = Number(presence?.activeSeconds || 0);
    return {
      ...row,
      isOnline,
      lastSeenAt,
      onlineSeconds,
      activeSeconds,
      activityRatio: onlineSeconds > 0 ? Math.min(1, activeSeconds / onlineSeconds) : 0,
      heartbeatCount: Number(presence?.heartbeatCount || 0),
    };
  });
}

export async function GET(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await ensureDb();
    const requestedProjectId = getRequestedProjectId(req);
    const presenceScopeProjectId = requestedProjectId ?? 0;

    if (requestedProjectId !== null) {
      if (!(await userCanAccessProject(user, requestedProjectId))) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      const rows = await db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          image: users.image,
          role: users.role,
        })
        .from(projectMembers)
        .innerJoin(users, eq(projectMembers.userId, users.id))
        .where(eq(projectMembers.projectId, requestedProjectId));
      const presenceRows = await db
        .select({
          userId: userPresence.userId,
          lastSeenAt: userPresence.lastSeenAt,
          onlineSeconds: userPresence.onlineSeconds,
          activeSeconds: userPresence.activeSeconds,
          heartbeatCount: userPresence.heartbeatCount,
        })
        .from(userPresence)
        .where(eq(userPresence.projectId, presenceScopeProjectId));
      return NextResponse.json(enrichWithPresence(rows, presenceRows));
    }

    if (isAdminUser(user)) {
      const rows = await db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          image: users.image,
          role: users.role,
        })
        .from(users);
      const presenceRows = await db
        .select({
          userId: userPresence.userId,
          lastSeenAt: userPresence.lastSeenAt,
          onlineSeconds: userPresence.onlineSeconds,
          activeSeconds: userPresence.activeSeconds,
          heartbeatCount: userPresence.heartbeatCount,
        })
        .from(userPresence)
        .where(eq(userPresence.projectId, presenceScopeProjectId));
      return NextResponse.json(enrichWithPresence(rows, presenceRows));
    }

    const accessibleProjectIds = await getAccessibleProjectIds(user);
    if (accessibleProjectIds.length === 0) {
      return NextResponse.json([]);
    }

    const rows = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        image: users.image,
        role: users.role,
      })
      .from(projectMembers)
      .innerJoin(users, eq(projectMembers.userId, users.id))
      .where(inArray(projectMembers.projectId, accessibleProjectIds));

    const seen = new Set<string>();
    const uniqueRows = rows.filter((row: (typeof rows)[number]) => {
      if (seen.has(row.id)) return false;
      seen.add(row.id);
      return true;
    });
    const presenceRows = await db
      .select({
        userId: userPresence.userId,
        lastSeenAt: userPresence.lastSeenAt,
        onlineSeconds: userPresence.onlineSeconds,
        activeSeconds: userPresence.activeSeconds,
        heartbeatCount: userPresence.heartbeatCount,
      })
      .from(userPresence)
      .where(eq(userPresence.projectId, presenceScopeProjectId));

    return NextResponse.json(enrichWithPresence(uniqueRows, presenceRows));
  } catch (error) {
    console.error('Error fetching team members:', error);
    return NextResponse.json([], { status: 200 });
  }
}
