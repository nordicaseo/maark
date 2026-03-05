import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { logAlertEvent, logAuditEvent } from '@/lib/observability';
import {
  getSharedUserProfile,
  setSharedUserProfile,
} from '@/lib/agents/project-agent-profiles';

export async function GET() {
  const auth = await requireRole('admin');
  if (auth.error) return auth.error;

  try {
    const content = await getSharedUserProfile();
    return NextResponse.json({ key: 'USER_MD', content });
  } catch (error) {
    await logAlertEvent({
      source: 'admin',
      eventType: 'agent_shared_user_load_failed',
      severity: 'error',
      message: 'Failed to load shared USER profile.',
      metadata: { error: error instanceof Error ? error.message : 'Unknown error' },
    });
    console.error('Admin shared-user GET failed:', error);
    return NextResponse.json({ error: 'Failed to load shared profile' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await requireRole('admin');
  if (auth.error) return auth.error;

  try {
    const body = await req.json();
    if (typeof body.content !== 'string') {
      return NextResponse.json({ error: 'content is required' }, { status: 400 });
    }

    const content = await setSharedUserProfile(body.content, auth.user.id);

    await logAuditEvent({
      userId: auth.user.id,
      action: 'admin.agent_shared_user.update',
      resourceType: 'agent_shared_profile',
      resourceId: 'USER_MD',
      metadata: {
        contentLength: content.length,
      },
    });

    return NextResponse.json({ key: 'USER_MD', content });
  } catch (error) {
    await logAlertEvent({
      source: 'admin',
      eventType: 'agent_shared_user_update_failed',
      severity: 'error',
      message: 'Failed to update shared USER profile.',
      metadata: { error: error instanceof Error ? error.message : 'Unknown error' },
    });
    console.error('Admin shared-user PATCH failed:', error);
    return NextResponse.json({ error: 'Failed to update shared profile' }, { status: 500 });
  }
}

