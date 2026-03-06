import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DocumentList } from '@/components/documents/document-list';
import type { ContentItemCard } from '@/types/content-item';

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

const baseDoc: ContentItemCard = {
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
  task: {
    id: 'task_1',
    status: 'IN_PROGRESS',
    workflowTemplateKey: 'topic_production_v1',
    workflowCurrentStageKey: 'outline_build',
    workflowStageStatus: 'active',
    workflowLastEventText: 'Outline draft ready for review.',
    workflowLastEventAt: Date.now(),
    deliverables: [],
  },
  workflowRuntimeState: 'working',
  workflowStageLabel: 'Outline',
  deliverableReadiness: {
    researchReady: true,
    outlineReady: true,
    prewriteReady: false,
    writingReady: false,
  },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function makeDoc(id: number): Document {
  return {
    ...baseDoc,
    id,
    title: `${baseDoc.title} ${id}`,
  };
}

describe('DocumentList sidebar cards', () => {
  it('renders long title/status cards with sectioned workflow/readiness layout', () => {
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
    expect(title.className).toContain('line-clamp-2');

    const statuses = screen.getAllByText('Working');
    expect(statuses.length).toBeGreaterThan(0);
    expect(screen.getByText('Outline')).toBeInTheDocument();
    expect(screen.getByText(/Prewrite Needs Input/)).toBeInTheDocument();
    expect(screen.getByText('Quick Review')).toBeInTheDocument();

    const card = title.closest('[role="button"]');
    expect(card).toBeInTheDocument();
    expect(card?.className).not.toContain('overflow-hidden');

    const deleteButton = screen.getByRole('button', { name: 'Delete document' });
    expect(deleteButton).toBeInTheDocument();
    expect(deleteButton.className).not.toContain('absolute');
  });

  it('keeps footer links visible for large document lists', () => {
    const manyDocs = Array.from({ length: 120 }, (_, i) => makeDoc(i + 1));

    render(
      <DocumentList
        documents={manyDocs}
        activeId={1}
        onRefresh={() => {}}
        activeProjectId={1}
        onProjectChange={() => {}}
      />
    );

    const keywordsLink = screen.getByRole('link', { name: 'Keywords' });
    const pagesLink = screen.getByRole('link', { name: 'Pages' });

    expect(keywordsLink).toBeInTheDocument();
    expect(pagesLink).toBeInTheDocument();
    expect(keywordsLink).toHaveAttribute('href', '/keywords?projectId=1');
    expect(pagesLink).toHaveAttribute('href', '/pages?projectId=1');
  });
});
