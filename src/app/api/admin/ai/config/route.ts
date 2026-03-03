import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/db/index';
import { dbNow } from '@/db/utils';
import { aiModelConfig, aiProviders } from '@/db/schema';
import { eq } from 'drizzle-orm';

export async function GET() {
  await ensureDb();
  try {
    const configs = await db.select().from(aiModelConfig);
    const providers = await db.select().from(aiProviders);

    const providerMap = new Map<number, any>(providers.map((p: any) => [p.id, p]));

    const enriched = configs.map((c: any) => {
      const provider = providerMap.get(c.providerId);
      return {
        ...c,
        providerName: provider?.name ?? 'unknown',
        providerDisplayName: provider?.displayName ?? 'Unknown',
      };
    });

    return NextResponse.json(enriched);
  } catch (error) {
    console.error('Error fetching AI config:', error);
    return NextResponse.json([], { status: 200 });
  }
}

export async function PUT(req: NextRequest) {
  await ensureDb();
  try {
    const body = await req.json();
    const { action, providerId, model, maxTokens, temperature } = body;

    if (!action || !providerId || !model) {
      return NextResponse.json(
        { error: 'action, providerId, and model are required' },
        { status: 400 }
      );
    }

    // Check if config already exists for this action
    const existing = await db
      .select()
      .from(aiModelConfig)
      .where(eq(aiModelConfig.action, action));

    let result;
    if (existing.length > 0) {
      [result] = await db
        .update(aiModelConfig)
        .set({
          providerId,
          model,
          maxTokens: maxTokens ?? 4096,
          temperature: temperature ?? 1.0,
          updatedAt: dbNow(),
        })
        .where(eq(aiModelConfig.action, action))
        .returning();
    } else {
      [result] = await db
        .insert(aiModelConfig)
        .values({
          action,
          providerId,
          model,
          maxTokens: maxTokens ?? 4096,
          temperature: temperature ?? 1.0,
        })
        .returning();
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error upserting AI config:', error);
    return NextResponse.json(
      { error: 'Failed to save config' },
      { status: 500 }
    );
  }
}
