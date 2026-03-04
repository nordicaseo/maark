export type PageIssueSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface ManagedPage {
  id: number;
  projectId: number;
  url: string;
  title: string | null;
  canonicalUrl: string | null;
  httpStatus: number | null;
  isIndexable: number | null;
  isVerified: number | null;
  responseTimeMs: number | null;
  contentHash: string | null;
  lastCrawledAt: string | null;
  createdAt: string;
  updatedAt: string;
  openIssues?: number;
}

export interface PageIssue {
  id: number;
  pageId: number;
  snapshotId: number | null;
  issueType: string;
  severity: PageIssueSeverity;
  message: string;
  isOpen: number;
  metadata: unknown;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
}
