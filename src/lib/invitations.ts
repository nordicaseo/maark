import type { NextRequest } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';

export type InvitationDeliveryStatus = 'sent' | 'failed' | 'fallback_only';
export type InvitationStatus = 'pending' | 'accepted' | 'expired' | 'revoked';
export type InvitationDeliveryChannel = 'resend' | 'supabase' | 'none';

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
  inviteUrl: string;
}): Promise<{
  deliveryStatus: InvitationDeliveryStatus;
  deliveryChannel: InvitationDeliveryChannel;
  deliveryError: string | null;
  lastSentAt: Date | null;
}> {
  if (!args.email) {
    return {
      deliveryStatus: 'fallback_only',
      deliveryChannel: 'none',
      deliveryError: null,
      lastSentAt: null,
    };
  }

  const resendApiKey = process.env.RESEND_API_KEY?.trim();
  const resendFromEmail = process.env.INVITATION_FROM_EMAIL?.trim() || process.env.RESEND_FROM_EMAIL?.trim();
  const resendFromName = process.env.INVITATION_FROM_NAME?.trim() || 'Maark';

  if (resendApiKey && resendFromEmail) {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: `${resendFromName} <${resendFromEmail}>`,
          to: [args.email],
          subject: 'You are invited to Maark',
          html: [
            '<div style="font-family:Arial,sans-serif;line-height:1.45;color:#1f2937">',
            '<h2 style="margin:0 0 12px">You are invited to Maark</h2>',
            '<p style="margin:0 0 12px">Click the link below to accept your invitation and sign in.</p>',
            `<p style="margin:0 0 16px"><a href="${args.inviteUrl}" style="display:inline-block;padding:10px 14px;background:#c9732f;color:#fff;text-decoration:none;border-radius:8px">Accept Invitation</a></p>`,
            '<p style="margin:0 0 8px;color:#6b7280;font-size:12px">If the button does not work, copy this URL:</p>',
            `<p style="margin:0;color:#6b7280;font-size:12px;word-break:break-all">${args.inviteUrl}</p>`,
            '</div>',
          ].join(''),
        }),
      });

      const payload = await response.json().catch(() => ({} as { message?: string; error?: string }));
      if (response.ok) {
        return {
          deliveryStatus: 'sent',
          deliveryChannel: 'resend',
          deliveryError: null,
          lastSentAt: new Date(),
        };
      }
      return {
        deliveryStatus: 'failed',
        deliveryChannel: 'resend',
        deliveryError:
          payload.message ||
          payload.error ||
          `Resend API failed (${response.status})`,
        lastSentAt: null,
      };
    } catch (error) {
      return {
        deliveryStatus: 'failed',
        deliveryChannel: 'resend',
        deliveryError: error instanceof Error ? error.message : 'Resend request failed',
        lastSentAt: null,
      };
    }
  }

  const supabaseAdmin = getSupabaseAdminClient();
  if (!supabaseAdmin) {
    return {
      deliveryStatus: 'fallback_only',
      deliveryChannel: 'none',
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
      deliveryChannel: 'supabase',
      deliveryError: error.message,
      lastSentAt: null,
    };
  }

  return {
    deliveryStatus: 'sent',
    deliveryChannel: 'supabase',
    deliveryError: null,
    lastSentAt: new Date(),
  };
}
