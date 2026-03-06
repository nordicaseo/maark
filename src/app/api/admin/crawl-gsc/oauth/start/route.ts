import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { userCanAccessProject } from '@/lib/access';
import {
  buildGoogleOAuthUrl,
  buildGscOAuthState,
  getGoogleOAuthConfig,
  getGoogleOAuthRedirectUri,
} from '@/lib/gsc/oauth';

function parseProjectId(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export async function GET(req: NextRequest) {
  const auth = await requireRole('admin');
  if (auth.error) return auth.error;

  const projectId = parseProjectId(req.nextUrl.searchParams.get('projectId'));
  if (!projectId) {
    return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
  }

  if (!(await userCanAccessProject(auth.user, projectId))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let oauthConfig;
  try {
    oauthConfig = getGoogleOAuthConfig();
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Google OAuth is not configured.' },
      { status: 500 }
    );
  }

  const state = buildGscOAuthState({
    projectId,
    userId: auth.user.id,
  });
  const redirectUri = getGoogleOAuthRedirectUri(req.nextUrl.origin);
  const url = buildGoogleOAuthUrl({
    clientId: oauthConfig.clientId,
    redirectUri,
    state,
  });

  return NextResponse.json({
    projectId,
    url,
  });
}
