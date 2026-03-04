import { NextRequest, NextResponse } from 'next/server';
import { db, ensureDb } from '@/db/index';
import { dbNow } from '@/db/utils';
import { aiModelConfig, aiProviders } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { requireRole } from '@/lib/auth';
import { logAlertEvent, logAuditEvent } from '@/lib/observability';

export async function GET() {
  await ensureDb();
  const auth = await requireRole('admin');
  if (auth.error) return auth.error;
  try {
    const configs = (await db.select().from(aiModelConfig)) as Array<{
      id: number;
      action: string;
      providerId: number;
      model: string;
      maxTokens: number;
      temperature: number;
    }>;
    const providers = (await db.select().from(aiProviders)) as Array<{
      id: number;
      name: string;
      displayName: string | null;
    }>;

    const providerMap = new Map<number, (typeof providers)[number]>();
    for (const provider of providers) {
      providerMap.set(provider.id, provider);
    }

    const enriched = configs.map((c) => {
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
  const auth = await requireRole('admin');
  if (auth.error) return auth.error;
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

    await logAuditEvent({
      userId: auth.user.id,
      action: 'admin.ai.config_upsert',
      resourceType: 'ai_model_config',
      resourceId: result.id,
      severity: 'warning',
      metadata: { action, providerId, model },
    });

    return NextResponse.json(result);
  } catch (error) {
    await logAlertEvent({
      source: 'admin',
      eventType: 'ai_config_upsert_failed',
      severity: 'error',
      message: 'Failed to save AI model configuration.',
      metadata: { error: error instanceof Error ? error.message : 'Unknown error' },
    });
    console.error('Error upserting AI config:', error);
    return NextResponse.json(
      { error: 'Failed to save config' },
      { status: 500 }
    );
  }
}
