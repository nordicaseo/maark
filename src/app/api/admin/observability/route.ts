import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/db';
import { alertEvents, auditLogs } from '@/db/schema';
import { desc } from 'drizzle-orm';
import { requireRole } from '@/lib/auth';

export async function GET(req: NextRequest) {
  await ensureDb();
  const auth = await requireRole('super_admin');
  if (auth.error) return auth.error;

  const limitParam = Number.parseInt(req.nextUrl.searchParams.get('limit') || '50', 10);
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 200) : 50;

  try {
    const [alerts, audits] = await Promise.all([
      db.select().from(alertEvents).orderBy(desc(alertEvents.createdAt)).limit(limit),
      db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(limit),
    ]);

    return NextResponse.json({ alerts, audits });
  } catch (error) {
    console.error('Error fetching observability data:', error);
    return NextResponse.json({ alerts: [], audits: [] }, { status: 200 });
  }
}
