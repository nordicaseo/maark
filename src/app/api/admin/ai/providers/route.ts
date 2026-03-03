import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/db/index';
import { aiProviders } from '@/db/schema';
import { desc } from 'drizzle-orm';

function maskApiKey(key: string): string {
  if (!key || key.length <= 8) return '********';
  return '********' + key.slice(-8);
}

export async function GET() {
  await ensureDb();
  try {
    const rows = await db.select().from(aiProviders).orderBy(desc(aiProviders.createdAt));
    const masked = rows.map((r: any) => ({
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
