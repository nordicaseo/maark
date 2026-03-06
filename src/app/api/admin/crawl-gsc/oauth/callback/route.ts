import { NextRequest, NextResponse } from 'next/server';
import { desc, eq } from 'drizzle-orm';
import { db, ensureDb } from '@/db';
import { projects, sites } from '@/db/schema';
import { dbNow } from '@/db/utils';
import { getAuthUser } from '@/lib/auth';
import { userCanAccessProject } from '@/lib/access';
import { hasRole } from '@/lib/permissions';
import {
  exchangeGoogleCodeForTokens,
  getGoogleOAuthRedirectUri,
  parseAndVerifyGscOAuthState,
} from '@/lib/gsc/oauth';
import { listGscPropertiesForProject } from '@/lib/gsc/sync';
import { logAuditEvent } from '@/lib/observability';

function buildRedirect(req: NextRequest, projectId: number | null, status: string, message?: string) {
  const url = new URL('/admin/crawl-gsc', req.nextUrl.origin);
  if (projectId) url.searchParams.set('projectId', String(projectId));
  url.searchParams.set('oauth', status);
  if (message) url.searchParams.set('msg', message);
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest) {
  await ensureDb();

  const code = req.nextUrl.searchParams.get('code');
  const stateRaw = req.nextUrl.searchParams.get('state');
  if (!code || !stateRaw) {
    return buildRedirect(req, null, 'invalid', 'Missing code/state from Google OAuth callback.');
  }

  let state: { projectId: number; userId: string; issuedAt: number };
  try {
    state = parseAndVerifyGscOAuthState(stateRaw);
  } catch (error) {
    return buildRedirect(
      req,
      null,
      'invalid_state',
      error instanceof Error ? error.message : 'OAuth state validation failed.'
    );
  }

  const authUser = await getAuthUser();
  if (!authUser || !hasRole(authUser.role, 'admin') || authUser.id !== state.userId) {
    return buildRedirect(req, state.projectId, 'forbidden', 'Sign in as the initiating admin to complete GSC connect.');
  }

  if (!(await userCanAccessProject(authUser, state.projectId))) {
    return buildRedirect(req, state.projectId, 'forbidden', 'You do not have access to this project.');
  }

  const [project] = await db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(eq(projects.id, state.projectId))
    .limit(1);

  if (!project) {
    return buildRedirect(req, state.projectId, 'missing_project', 'Project was not found.');
  }

  const [site] = await db
    .select()
    .from(sites)
    .where(eq(sites.projectId, state.projectId))
    .orderBy(desc(sites.isPrimary), desc(sites.updatedAt))
    .limit(1);

  if (!site) {
    return buildRedirect(req, state.projectId, 'missing_site', 'Configure project domain first, then connect GSC.');
  }

  try {
    const redirectUri = getGoogleOAuthRedirectUri(req.nextUrl.origin);
    const tokens = await exchangeGoogleCodeForTokens({
      code,
      redirectUri,
    });

    const now = dbNow();
    const expiresAt = tokens.expires_in
      ? (process.env.POSTGRES_URL
          ? new Date(Date.now() + Math.max(tokens.expires_in - 60, 0) * 1000)
          : new Date(Date.now() + Math.max(tokens.expires_in - 60, 0) * 1000).toISOString())
      : null;

    await db
      .update(sites)
      .set({
        gscAccessToken: tokens.access_token,
        gscRefreshToken: tokens.refresh_token || site.gscRefreshToken || null,
        gscTokenExpiresAt: expiresAt,
        gscConnectedAt: now,
        gscLastError: null,
        updatedAt: now,
      })
      .where(eq(sites.id, site.id));

    let propertyCount = 0;
    let selectedProperty: string | null = site.gscProperty ? String(site.gscProperty) : null;

    try {
      const properties = await listGscPropertiesForProject(state.projectId);
      propertyCount = properties.length;
      if (!selectedProperty && properties.length > 0) {
        selectedProperty = properties[0].siteUrl;
        await db
          .update(sites)
          .set({
            gscProperty: selectedProperty,
            updatedAt: dbNow(),
          })
          .where(eq(sites.id, site.id));
      }
    } catch {
      // keep OAuth success even if listing properties fails.
    }

    await logAuditEvent({
      userId: authUser.id,
      action: 'admin.crawl_gsc.oauth_connected',
      resourceType: 'project',
      resourceId: state.projectId,
      projectId: state.projectId,
      metadata: {
        projectName: project.name,
        siteId: site.id,
        selectedProperty,
        propertyCount,
      },
    });

    return buildRedirect(req, state.projectId, 'connected');
  } catch (error) {
    return buildRedirect(
      req,
      state.projectId,
      'exchange_failed',
      error instanceof Error ? error.message : 'Google OAuth token exchange failed.'
    );
  }
}
