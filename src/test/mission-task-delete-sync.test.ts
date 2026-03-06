import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRequireRole = vi.fn();
const mockUserCanAccessProject = vi.fn();
const mockDeleteContentItemByTaskId = vi.fn();
const mockLogAuditEvent = vi.fn();
const mockLogAlertEvent = vi.fn();
const mockConvexQuery = vi.fn();

vi.mock('@/lib/auth', () => ({
  requireRole: mockRequireRole,
}));

vi.mock('@/lib/access', () => ({
  userCanAccessProject: mockUserCanAccessProject,
}));

vi.mock('@/lib/content-pipeline/delete-content-item', () => ({
  deleteContentItemByTaskId: mockDeleteContentItemByTaskId,
}));

vi.mock('@/lib/observability', () => ({
  logAuditEvent: mockLogAuditEvent,
  logAlertEvent: mockLogAlertEvent,
}));

vi.mock('@/lib/convex/server', () => ({
  getConvexClient: vi.fn(() => ({
    query: mockConvexQuery,
  })),
}));

describe('Mission control task delete sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireRole.mockResolvedValue({
      user: {
        id: 'user_1',
        email: 'owner@maark.ai',
        name: 'Owner',
        image: null,
        role: 'owner',
      },
      error: null,
    });
    mockUserCanAccessProject.mockResolvedValue(true);
  });

  it('returns idempotent success when task is already missing', async () => {
    const { DELETE } = await import('@/app/api/mission-control/tasks/[id]/route');
    mockConvexQuery.mockResolvedValueOnce(null);

    const res = await DELETE(new NextRequest('http://localhost/api/mission-control/tasks/t1', {
      method: 'DELETE',
    }), {
      params: Promise.resolve({ id: 't1' }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      alreadyDeleted: true,
    });
  });

  it('deletes linked content item through orchestrator', async () => {
    const { DELETE } = await import('@/app/api/mission-control/tasks/[id]/route');
    mockConvexQuery.mockResolvedValueOnce({
      _id: 'task_1',
      projectId: 2,
      documentId: 77,
    });
    mockDeleteContentItemByTaskId.mockResolvedValue({
      ok: true,
      mode: 'document_cascade',
      alreadyDeleted: false,
      deletedDocument: true,
      removedTaskCount: 2,
    });

    const res = await DELETE(new NextRequest('http://localhost/api/mission-control/tasks/task_1', {
      method: 'DELETE',
    }), {
      params: Promise.resolve({ id: 'task_1' }),
    });

    expect(mockDeleteContentItemByTaskId).toHaveBeenCalledWith({
      taskId: 'task_1',
      expectedProjectId: 2,
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      ok: true,
      mode: 'document_cascade',
      deletedDocument: true,
      removedTaskCount: 2,
    });
  });
});

