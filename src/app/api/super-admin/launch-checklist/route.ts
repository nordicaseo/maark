import { NextResponse } from 'next/server';
import { api } from '../../../../../convex/_generated/api';
import { ensureDb } from '@/db';
import { requireRole } from '@/lib/auth';
import { getConvexClient } from '@/lib/convex/server';

type ReadinessItem = {
  key: string;
  label: string;
  status: 'ok' | 'warning' | 'error';
  detail: string;
};

function envPresent(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

export async function GET() {
  await ensureDb();
  const auth = await requireRole('super_admin');
  if (auth.error) return auth.error;

  const items: ReadinessItem[] = [];

  const convex = getConvexClient();
  if (!convex) {
    items.push({
      key: 'convex',
      label: 'Convex Realtime',
      status: 'error',
      detail: 'Convex URL is not configured.',
    });
  } else {
    try {
      await convex.query(api.tasks.list, { limit: 1 });
      items.push({
        key: 'convex',
        label: 'Convex Realtime',
        status: 'ok',
        detail: 'Connected and queryable.',
      });
    } catch (error) {
      items.push({
        key: 'convex',
        label: 'Convex Realtime',
        status: 'error',
        detail: error instanceof Error ? error.message : 'Convex query failed.',
      });
    }
  }

  const supabaseBaseReady =
    envPresent('NEXT_PUBLIC_SUPABASE_URL') &&
    envPresent('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  const supabaseServiceReady = envPresent('SUPABASE_SERVICE_ROLE_KEY');

  items.push({
    key: 'supabase-auth',
    label: 'Supabase Auth',
    status: supabaseBaseReady ? 'ok' : 'error',
    detail: supabaseBaseReady
      ? 'Public Supabase keys configured.'
      : 'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.',
  });

  const resendReady = envPresent('RESEND_API_KEY') && (
    envPresent('INVITATION_FROM_EMAIL') || envPresent('RESEND_FROM_EMAIL')
  );
  items.push({
    key: 'invites',
    label: 'Invite Email Delivery',
    status: resendReady || supabaseServiceReady ? 'ok' : 'warning',
    detail: resendReady
      ? 'Branded invite email configured (Resend).'
      : supabaseServiceReady
        ? 'Fallback invite email via Supabase service role.'
        : 'No email sender configured. Invite links will be manual only.',
  });

  const firecrawlReady = envPresent('FIRECRAWL_API_KEY');
  items.push({
    key: 'crawler',
    label: 'Crawler Provider (Firecrawl)',
    status: firecrawlReady ? 'ok' : 'warning',
    detail: firecrawlReady
      ? 'FIRECRAWL_API_KEY is configured.'
      : 'FIRECRAWL_API_KEY missing. Crawls cannot run.',
  });

  const gscReady = envPresent('GOOGLE_CLIENT_ID') && envPresent('GOOGLE_CLIENT_SECRET');
  items.push({
    key: 'gsc-oauth',
    label: 'Google Search Console OAuth',
    status: gscReady ? 'ok' : 'warning',
    detail: gscReady
      ? 'Google OAuth credentials configured.'
      : 'Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET.',
  });

  const openAiReady = envPresent('OPENAI_API_KEY');
  const anthropicReady = envPresent('ANTHROPIC_API_KEY');
  items.push({
    key: 'ai-provider',
    label: 'AI Providers',
    status: openAiReady || anthropicReady ? 'ok' : 'warning',
    detail: openAiReady || anthropicReady
      ? `Configured: ${[
          openAiReady ? 'OpenAI' : null,
          anthropicReady ? 'Anthropic' : null,
        ].filter(Boolean).join(', ')}.`
      : 'No primary AI provider key configured.',
  });

  const errors = items.filter((item) => item.status === 'error').length;
  const warnings = items.filter((item) => item.status === 'warning').length;

  return NextResponse.json({
    checkedAt: new Date().toISOString(),
    summary: {
      ok: items.length - errors - warnings,
      warnings,
      errors,
      ready: errors === 0,
    },
    items,
  });
}
