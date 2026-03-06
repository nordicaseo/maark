import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { userCanAccessProject } from '@/lib/access';
import { listGscPropertiesForProject } from '@/lib/gsc/sync';

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

  try {
    const properties = await listGscPropertiesForProject(projectId);
    return NextResponse.json({
      projectId,
      properties,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load GSC properties.' },
      { status: 500 }
    );
  }
}
