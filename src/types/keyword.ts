export type KeywordIntent =
  | 'informational'
  | 'commercial'
  | 'transactional'
  | 'navigational'
  | 'local';

export type KeywordStatus =
  | 'new'
  | 'planned'
  | 'in_progress'
  | 'content_created'
  | 'published'
  | 'archived';

export type KeywordPriority = 'low' | 'medium' | 'high';

export interface Keyword {
  id: number;
  projectId: number;
  keyword: string;
  intent: KeywordIntent;
  status: KeywordStatus;
  priority: KeywordPriority;
  ownerId: string | null;
  ownerName?: string | null;
  volume: number | null;
  difficulty: number | null;
  targetUrl: string | null;
  notes: string | null;
  lastTaskId: string | null;
  createdAt: string;
  updatedAt: string;
}

export const KEYWORD_STATUS_LABELS: Record<KeywordStatus, string> = {
  new: 'New',
  planned: 'Planned',
  in_progress: 'In Progress',
  content_created: 'Content Created',
  published: 'Published',
  archived: 'Archived',
};

export const KEYWORD_INTENT_LABELS: Record<KeywordIntent, string> = {
  informational: 'Informational',
  commercial: 'Commercial',
  transactional: 'Transactional',
  navigational: 'Navigational',
  local: 'Local',
};
