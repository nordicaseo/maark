import type { ContentFormat } from '@/types/document';

export type ColonPolicy = 'allow' | 'forbid' | 'structural_only';
export type EmDashPolicy = 'allow' | 'forbid';

export interface WordRangePolicy {
  min: number;
  max: number;
}

export interface OutlineConstraintPolicy {
  maxH2: number;
  maxH3PerH2: number;
}

export interface StyleGuardPolicy {
  emDash: EmDashPolicy;
  colon: ColonPolicy;
  maxNarrativeColons: number;
}

export interface ContentTemplateConfig {
  id: number;
  key: string;
  name: string;
  description: string | null;
  contentFormats: ContentFormat[];
  structure: {
    sections: Array<{
      heading: string;
      level: 1 | 2 | 3;
      optional?: boolean;
    }>;
  };
  wordRange: WordRangePolicy;
  outlineConstraints: OutlineConstraintPolicy;
  styleGuard: StyleGuardPolicy;
  isSystem: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateAssignment {
  id: number;
  scope: 'global' | 'project';
  scopeKey: string;
  projectId: number | null;
  contentFormat: ContentFormat;
  templateKey: string;
  createdAt: string;
  updatedAt: string;
}
