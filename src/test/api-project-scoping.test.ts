import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockEnsureDb = vi.fn();
const mockDb = {
  select: vi.fn(),
  insert: vi.fn(),
};

const mockGetAuthUser = vi.fn();
const mockRequireRole = vi.fn();

const mockGetRequestedProjectId = vi.fn();
const mockGetAccessibleProjectIds = vi.fn();
const mockIsAdminUser = vi.fn();
const mockUserCanAccessProject = vi.fn();

vi.mock('@/db', () => ({
  db: mockDb,
  ensureDb: mockEnsureDb,
}));

vi.mock('@/db/index', () => ({
  db: mockDb,
  ensureDb: mockEnsureDb,
}));

vi.mock('@/lib/auth', () => ({
  getAuthUser: mockGetAuthUser,
  requireRole: mockRequireRole,
}));

vi.mock('@/lib/access', () => ({
  getRequestedProjectId: mockGetRequestedProjectId,
  getAccessibleProjectIds: mockGetAccessibleProjectIds,
  isAdminUser: mockIsAdminUser,
  userCanAccessProject: mockUserCanAccessProject,
}));

vi.mock('@/lib/convex/server', () => ({
  getConvexClient: vi.fn(() => null),
}));

describe('API project scoping and authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnsureDb.mockResolvedValue(undefined);
    mockGetRequestedProjectId.mockReturnValue(null);
    mockGetAccessibleProjectIds.mockResolvedValue([]);
    mockIsAdminUser.mockReturnValue(false);
  });

  it('returns 401 for unauthenticated documents GET', async () => {
    const { GET } = await import('@/app/api/documents/route');
    mockGetAuthUser.mockResolvedValue(null);

    const res = await GET(new NextRequest('http://localhost/api/documents'));
    expect(res.status).toBe(401);
  });

  it('returns 403 when creating document for inaccessible project', async () => {
    const { POST } = await import('@/app/api/documents/route');
    mockGetAuthUser.mockResolvedValue({
      id: 'u1',
      email: 'user@example.com',
      name: 'User',
      image: null,
      role: 'writer',
    });
    mockUserCanAccessProject.mockResolvedValue(false);

    const req = new NextRequest('http://localhost/api/documents', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Scoped Doc',
        projectId: 42,
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it('returns 403 when non-admin requests another user projects', async () => {
    const { GET } = await import('@/app/api/projects/route');
    mockGetAuthUser.mockResolvedValue({
      id: 'u1',
      email: 'user@example.com',
      name: 'User',
      image: null,
      role: 'writer',
    });
    mockIsAdminUser.mockReturnValue(false);

    const req = new NextRequest('http://localhost/api/projects?userId=another-user');
    const res = await GET(req);
    expect(res.status).toBe(403);
  });

  it('returns 410 when calling retired skills API', async () => {
    const { POST } = await import('@/app/api/skills/route');
    mockRequireRole.mockResolvedValue({
      user: {
        id: 'editor-1',
        email: 'editor@example.com',
        name: 'Editor',
        image: null,
        role: 'editor',
      },
      error: null,
    });
    mockIsAdminUser.mockReturnValue(false);
    mockUserCanAccessProject.mockResolvedValue(false);

    const req = new NextRequest('http://localhost/api/skills', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Skill',
        content: 'Skill body',
        projectId: 99,
      }),
      headers: { 'Content-Type': 'application/json' },
    });

    const res = await POST(req);
    expect(res.status).toBe(410);
  });
});
