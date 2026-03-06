export type PageIssueSeverity = 'low' | 'medium' | 'high' | 'critical';
export type DiscoverySource = 'sitemap' | 'gsc' | 'inventory' | 'crawl';
export type PageEligibilityState = 'eligible' | 'excluded' | 'retired';
export type DiscoveryExcludeReason =
  | 'query_variant'
  | 'faceted_variant'
  | 'legal_page'
  | 'contact_page'
  | 'system_page'
  | 'search_page'
  | 'cart_or_account'
  | 'category_or_tag'
  | 'non_canonical'
  | 'non_indexable'
  | 'non_200'
  | 'blocked_by_rule'
  | 'invalid_url';

export interface ManagedPage {
  id: number;
  projectId: number;
  siteId?: number | null;
  url: string;
  normalizedUrl?: string;
  urlHash?: string | null;
  title: string | null;
  canonicalUrl: string | null;
  httpStatus: number | null;
  isIndexable: number | null;
  isVerified: number | null;
  discoverySource?: DiscoverySource;
  eligibilityState?: PageEligibilityState;
  excludeReason?: DiscoveryExcludeReason | string | null;
  responseTimeMs: number | null;
  contentHash: string | null;
  firstSeenAt?: string | null;
  lastSeenAt?: string | null;
  isActive?: number;
  lastCrawledAt: string | null;
  createdAt: string;
  updatedAt: string;
  openIssues?: number;
  linkedDocumentCount?: number;
}

export interface DiscoveryUrlRecord {
  id: number;
  projectId: number;
  siteId: number | null;
  pageId: number | null;
  url: string;
  normalizedUrl: string;
  source: DiscoverySource;
  isCandidate: number;
  excludeReason: DiscoveryExcludeReason | string | null;
  canonicalTarget: string | null;
  httpStatus: number | null;
  robots: string | null;
  seenAt: string;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface LinkedDocumentPreview {
  documentId: number;
  title: string;
  status: string;
  previewUrl: string | null;
  relationType: string;
  isPrimary: number;
  updatedAt: string;
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

export interface PageDataHealth {
  projectId: number;
  siteId: number | null;
  siteDomain: string | null;
  gsc: {
    configured: boolean;
    connected: boolean;
    healthy: boolean;
    status: string;
    lastSyncAt: string | null;
    error: string | null;
  };
  crawl: {
    healthy: boolean;
    status: string;
    lastRunAt: string | null;
    error: string | null;
    pendingQueue: number;
  };
}
