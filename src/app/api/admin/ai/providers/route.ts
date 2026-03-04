import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/db/index';
import { aiProviders } from '@/db/schema';
import { desc } from 'drizzle-orm';
import { requireRole } from '@/lib/auth';

function maskApiKey(key: string): string {
  if (!key || key.length <= 8) return '********';
  return '********' + key.slice(-8);
}

export async function GET() {
  await ensureDb();
  const auth = await requireRole('admin');
  if (auth.error) return auth.error;
  try {
    const rows = (await db
      .select()
      .from(aiProviders)
      .orderBy(desc(aiProviders.createdAt))) as Array<{
      id: number;
      name: string;
      displayName: string | null;
      apiKey: string;
      isActive: boolean;
    }>;
    const masked = rows.map((r) => ({
      ...r,
      apiKey: maskApiKey(r.apiKey),
    }));
    return NextResponse.json(masked);
  } catch (error) {
    console.error('Error fetching providers:', error);
    return NextResponse.json([], { status: 200 });
  }
}

export async function POST(req: NextRequest) {
  await ensureDb();
  const auth = await requireRole('admin');
  if (auth.error) return auth.error;
  try {
    const body = await req.json();
    const { name, displayName, apiKey, isActive } = body;

    if (!name || !apiKey) {
      return NextResponse.json(
        { error: 'name and apiKey are required' },
        { status: 400 }
      );
    }

    const [provider] = await db
      .insert(aiProviders)
      .values({
        name,
        displayName: displayName || name,
        apiKey,
        isActive: isActive !== undefined ? !!isActive : true,
      })
      .returning();

    return NextResponse.json({
      ...provider,
      apiKey: maskApiKey(provider.apiKey),
    });
  } catch (error) {
    console.error('Error creating provider:', error);
    return NextResponse.json(
      { error: 'Failed to create provider' },
      { status: 500 }
    );
  }
}
