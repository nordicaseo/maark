import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/db/index';
import { aiUsageLog } from '@/db/schema';
import { eq, and, gte, sql } from 'drizzle-orm';
import { requireRole } from '@/lib/auth';

/**
 * GET /api/admin/ai/usage
 *
 * Query params:
 *   taskId   — return usage rows for a specific task
 *   projectId — return aggregated spend for a project
 *   since    — ISO date string, defaults to 24h ago
 */
export async function GET(req: NextRequest) {
  await ensureDb();
  const auth = await requireRole('super_admin');
  if (auth.error) return auth.error;

  const { searchParams } = req.nextUrl;
  const taskId = searchParams.get('taskId');
  const projectId = searchParams.get('projectId');
  const since = searchParams.get('since');

  try {
    if (taskId) {
      // Return all usage rows for a specific task
      const rows = await db
        .select()
        .from(aiUsageLog)
        .where(eq(aiUsageLog.taskId, taskId));

      const totalCostCents = rows.reduce(
        (sum: number, r: { costCents: number | null }) => sum + (r.costCents ?? 0),
        0
      );

      return NextResponse.json({
        taskId,
        rows,
        totalCostCents,
        totalCostFormatted: `$${(totalCostCents / 100).toFixed(2)}`,
      });
    }

    // Project spend summary
    const sinceDate = since
      ? new Date(since)
      : new Date(Date.now() - 24 * 60 * 60 * 1000);

    const conditions = [gte(aiUsageLog.createdAt, sinceDate.toISOString())];
    if (projectId) {
      conditions.push(eq(aiUsageLog.projectId, Number(projectId)) as ReturnType<typeof eq>);
    }

    const rows = await db
      .select({
        projectId: aiUsageLog.projectId,
        totalCostCents: sql<number>`COALESCE(SUM(${aiUsageLog.costCents}), 0)`,
        totalInputTokens: sql<number>`COALESCE(SUM(${aiUsageLog.inputTokens}), 0)`,
        totalOutputTokens: sql<number>`COALESCE(SUM(${aiUsageLog.outputTokens}), 0)`,
        callCount: sql<number>`COUNT(*)`,
      })
      .from(aiUsageLog)
      .where(and(...conditions))
      .groupBy(aiUsageLog.projectId);

    type SpendRow = { totalCostCents: number; totalInputTokens: number; totalOutputTokens: number; callCount: number };
    const overall = (rows as SpendRow[]).reduce(
      (acc: SpendRow, r: SpendRow) => ({
        totalCostCents: acc.totalCostCents + (r.totalCostCents ?? 0),
        totalInputTokens: acc.totalInputTokens + (r.totalInputTokens ?? 0),
        totalOutputTokens: acc.totalOutputTokens + (r.totalOutputTokens ?? 0),
        callCount: acc.callCount + (r.callCount ?? 0),
      }),
      { totalCostCents: 0, totalInputTokens: 0, totalOutputTokens: 0, callCount: 0 }
    );

    return NextResponse.json({
      since: sinceDate.toISOString(),
      projects: rows,
      overall: {
        ...overall,
        totalCostFormatted: `$${(overall.totalCostCents / 100).toFixed(2)}`,
      },
    });
  } catch (error) {
    console.error('AI usage query failed:', error);
    return NextResponse.json({ error: 'Failed to load AI usage data' }, { status: 500 });
  }
}
