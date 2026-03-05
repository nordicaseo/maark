import type { NextRequest } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';

export type InvitationDeliveryStatus = 'sent' | 'failed' | 'fallback_only';
export type InvitationStatus = 'pending' | 'accepted' | 'expired' | 'revoked';

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

export function resolveAppBaseUrl(req: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return trimTrailingSlash(configured);

  const forwardedHost = req.headers.get('x-forwarded-host');
  if (forwardedHost) {
    const proto = req.headers.get('x-forwarded-proto') || 'https';
    return trimTrailingSlash(`${proto}://${forwardedHost}`);
  }

  const host = req.headers.get('host');
  if (host) {
    const proto = host.includes('localhost') ? 'http' : 'https';
    return trimTrailingSlash(`${proto}://${host}`);
  }

  const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (productionHost) {
    return trimTrailingSlash(`https://${productionHost}`);
  }

  const deploymentHost = process.env.VERCEL_URL?.trim();
  if (deploymentHost) {
    return trimTrailingSlash(`https://${deploymentHost}`);
  }

  return 'http://localhost:3000';
}

export function buildInvitationUrls(req: NextRequest, token: string) {
  const baseUrl = resolveAppBaseUrl(req);
  return {
    baseUrl,
    inviteUrl: `${baseUrl}/auth/invite?token=${token}`,
    redirectTo: `${baseUrl}/auth/callback?next=/documents&invite_token=${token}`,
  };
}

function parseDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  const parsed = new Date(String(value));
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

export function resolveInvitationStatus(invitation: {
  acceptedAt?: unknown;
  expiresAt?: unknown;
  revokedAt?: unknown;
}): InvitationStatus {
  if (invitation.revokedAt) return 'revoked';
  if (invitation.acceptedAt) return 'accepted';
  const expiresAt = parseDate(invitation.expiresAt);
  if (expiresAt && expiresAt.getTime() < Date.now()) return 'expired';
  return 'pending';
}

export function isInvitationExpired(expiresAt: unknown): boolean {
  const date = parseDate(expiresAt);
  if (!date) return true;
  return date.getTime() < Date.now();
}

export async function sendInvitationEmail(args: {
  email: string | null;
  redirectTo: string;
}): Promise<{
  deliveryStatus: InvitationDeliveryStatus;
  deliveryError: string | null;
  lastSentAt: Date | null;
}> {
  if (!args.email) {
    return {
      deliveryStatus: 'fallback_only',
      deliveryError: null,
      lastSentAt: null,
    };
  }

  const supabaseAdmin = getSupabaseAdminClient();
  if (!supabaseAdmin) {
    return {
      deliveryStatus: 'fallback_only',
      deliveryError: 'Supabase service role is not configured.',
      lastSentAt: null,
    };
  }

  const { error } = await supabaseAdmin.auth.admin.inviteUserByEmail(args.email, {
    redirectTo: args.redirectTo,
  });

  if (error) {
    return {
      deliveryStatus: 'failed',
      deliveryError: error.message,
      lastSentAt: null,
    };
  }

  return {
    deliveryStatus: 'sent',
    deliveryError: null,
    lastSentAt: new Date(),
  };
}
