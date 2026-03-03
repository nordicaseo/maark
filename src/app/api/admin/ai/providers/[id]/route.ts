import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/db/index';
import { dbNow } from '@/db/utils';
import { aiProviders } from '@/db/schema';
import { eq } from 'drizzle-orm';

function maskApiKey(key: string): string {
  if (!key || key.length <= 8) return '********';
  return '********' + key.slice(-8);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureDb();
  const { id } = await params;
  try {
    const body = await req.json();
    const updateData: any = { updatedAt: dbNow() };

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

    return NextResponse.json({
      ...provider,
      apiKey: maskApiKey(provider.apiKey),
    });
  } catch (error) {
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
  const { id } = await params;
  try {
    await db.delete(aiProviders).where(eq(aiProviders.id, parseInt(id, 10)));
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting provider:', error);
    return NextResponse.json(
      { error: 'Failed to delete provider' },
      { status: 500 }
    );
  }
}
