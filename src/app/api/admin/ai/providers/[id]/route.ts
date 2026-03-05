import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/db/index';
import { dbNow } from '@/db/utils';
import { aiProviders } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { requireRole } from '@/lib/auth';
import { logAlertEvent, logAuditEvent } from '@/lib/observability';

function maskApiKey(key: string): string {
  if (!key || key.length <= 8) return '********';
  return '********' + key.slice(-8);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureDb();
  const auth = await requireRole('super_admin');
  if (auth.error) return auth.error;
  const { id } = await params;
  try {
    const body = await req.json();
    const updateData: Record<string, unknown> = { updatedAt: dbNow() };

    if (body.name !== undefined) updateData.name = body.name;
    if (body.displayName !== undefined) updateData.displayName = body.displayName;
    if (body.apiKey !== undefined) updateData.apiKey = body.apiKey;
    if (body.isActive !== undefined) updateData.isActive = !!body.isActive;

    const [provider] = await db
      .update(aiProviders)
      .set(updateData)
      .where(eq(aiProviders.id, parseInt(id, 10)))
      .returning();

    if (!provider) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    await logAuditEvent({
      userId: auth.user.id,
      action: 'admin.ai.provider_update',
      resourceType: 'ai_provider',
      resourceId: provider.id,
      severity: 'warning',
      metadata: { isActive: provider.isActive, name: provider.name },
    });

    return NextResponse.json({
      ...provider,
      apiKey: maskApiKey(provider.apiKey),
    });
  } catch (error) {
    await logAlertEvent({
      source: 'admin',
      eventType: 'ai_provider_update_failed',
      severity: 'error',
      message: 'Failed to update AI provider.',
      resourceId: id,
      metadata: { error: error instanceof Error ? error.message : 'Unknown error' },
    });
    console.error('Error updating provider:', error);
    return NextResponse.json(
      { error: 'Failed to update provider' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureDb();
  const auth = await requireRole('super_admin');
  if (auth.error) return auth.error;
  const { id } = await params;
  try {
    await db.delete(aiProviders).where(eq(aiProviders.id, parseInt(id, 10)));

    await logAuditEvent({
      userId: auth.user.id,
      action: 'admin.ai.provider_delete',
      resourceType: 'ai_provider',
      resourceId: id,
      severity: 'warning',
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    await logAlertEvent({
      source: 'admin',
      eventType: 'ai_provider_delete_failed',
      severity: 'error',
      message: 'Failed to delete AI provider.',
      resourceId: id,
      metadata: { error: error instanceof Error ? error.message : 'Unknown error' },
    });
    console.error('Error deleting provider:', error);
    return NextResponse.json(
      { error: 'Failed to delete provider' },
      { status: 500 }
    );
  }
}
