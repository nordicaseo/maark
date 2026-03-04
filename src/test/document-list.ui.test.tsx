import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DocumentList } from '@/components/documents/document-list';
import type { Document } from '@/types/document';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

vi.mock('@/components/auth/auth-provider', () => ({
  useAuth: () => ({
    user: { role: 'owner' },
  }),
}));

vi.mock('@/components/projects/project-switcher', () => ({
  ProjectSwitcher: () => <div data-testid="project-switcher" />,
}));

vi.mock('@/components/documents/create-dialog', () => ({
  CreateDialog: () => null,
}));

const baseDoc: Document = {
  id: 1,
  projectId: 1,
  authorId: 'u1',
  authorName: 'User',
  title: 'Very long SEO title that should still wrap cleanly without clipping in the sidebar card',
  content: null,
  plainText: 'text',
  status: 'in_progress',
  contentType: 'blog_post',
  targetKeyword: 'long title keyword',
  wordCount: 1580,
  aiDetectionScore: 2.1,
  aiRiskLevel: 'Low',
  semanticScore: 71,
  contentQualityScore: 82,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe('DocumentList sidebar cards', () => {
  it('renders long title/status cards with wrapping and clipping protections', () => {
    render(
      <DocumentList
        documents={[baseDoc]}
        activeId={1}
        onRefresh={() => {}}
        activeProjectId={1}
        onProjectChange={() => {}}
      />
    );

    const title = screen.getByText(/Very long SEO title/);
    expect(title).toBeInTheDocument();
    expect(title.className).toContain('break-words');

    const status = screen.getByText('In Progress');
    expect(status).toBeInTheDocument();

    const card = title.closest('[role="button"]');
    expect(card).toBeInTheDocument();
    expect(card?.className).toContain('overflow-hidden');
  });
});
