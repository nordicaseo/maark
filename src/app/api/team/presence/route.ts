import { and, eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/db';
import { userPresence } from '@/db/schema';
import { dbNow } from '@/db/utils';
import { getAuthUser } from '@/lib/auth';
import { userCanAccessProject } from '@/lib/access';

function parseProjectId(value: unknown): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 0;
  return parsed;
}

function parseIso(value: unknown): Date | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await ensureDb();
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const projectId = parseProjectId(body.projectId);
  const active = body.active !== false;

  if (projectId > 0 && !(await userCanAccessProject(user, projectId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const [existing] = await db
    .select()
    .from(userPresence)
    .where(and(eq(userPresence.projectId, projectId), eq(userPresence.userId, user.id)))
    .limit(1);

  const nowIso = dbNow();
  const now = new Date(nowIso);
  const lastSeen = parseIso(existing?.lastSeenAt);
  const rawDeltaSeconds = lastSeen
    ? Math.floor((now.getTime() - lastSeen.getTime()) / 1000)
    : 0;
  const deltaSeconds =
    Number.isFinite(rawDeltaSeconds) && rawDeltaSeconds > 0
      ? Math.min(rawDeltaSeconds, 90)
      : 0;

  if (!existing) {
    await db.insert(userPresence).values({
      projectId,
      userId: user.id,
      isOnline: true,
      lastSeenAt: nowIso,
      onlineSeconds: active ? 30 : 0,
      activeSeconds: active ? 30 : 0,
      heartbeatCount: 1,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    return NextResponse.json({ ok: true });
  }

  await db
    .update(userPresence)
    .set({
      isOnline: true,
      lastSeenAt: nowIso,
      onlineSeconds: (existing.onlineSeconds || 0) + deltaSeconds,
      activeSeconds: (existing.activeSeconds || 0) + (active ? deltaSeconds : 0),
      heartbeatCount: (existing.heartbeatCount || 0) + 1,
      updatedAt: nowIso,
    })
    .where(eq(userPresence.id, existing.id));

  return NextResponse.json({ ok: true });
}
