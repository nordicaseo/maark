import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const CRON_PATHS = new Set<string>([
  '/api/topic-workflow/auto-resume',
  '/api/admin/crawl-gsc/cron',
]);

function isAuthorizedCronRequest(request: NextRequest): boolean {
  const { pathname } = request.nextUrl;
  if (!CRON_PATHS.has(pathname)) return false;

  if (request.headers.get('x-vercel-cron')) return true;

  const provided = request.headers
    .get('authorization')
    ?.replace(/^Bearer\s+/i, '')
    .trim();
  if (!provided) return false;

  const allowed = [process.env.WORKFLOW_CRON_SECRET, process.env.CRAWL_CRON_SECRET]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  if (allowed.length === 0) return false;

  return allowed.includes(provided);
}

export async function updateSession(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isAuthorizedCronRequest(request)) {
    return NextResponse.next({ request });
  }

  // Public routes — allow without auth check
  if (
    pathname.startsWith('/auth/') ||
    pathname.startsWith('/api/auth/invite') ||
    pathname.startsWith('/preview/') ||
    pathname.startsWith('/api/preview/') ||
    pathname === '/' ||
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/favicon')
  ) {
    return NextResponse.next({ request });
  }

  // Guard: if Supabase isn't configured, redirect to sign-in
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    const signInUrl = new URL('/auth/signin', request.url);
    signInUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(signInUrl);
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh the session — IMPORTANT: do not remove
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Redirect unauthenticated users to sign in
  if (!user) {
    const signInUrl = new URL('/auth/signin', request.url);
    signInUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(signInUrl);
  }

  return supabaseResponse;
}
