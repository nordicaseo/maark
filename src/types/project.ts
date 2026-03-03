import type { ContentFormat } from './document';

export interface Project {
  id: number;
  name: string;
  description: string | null;
  defaultContentFormat: ContentFormat;
  brandVoice: string | null;
  settings: ProjectSettings | null;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSettings {
  defaultTone?: string;
}

export interface ProjectMember {
  id: number;
  projectId: number;
  userId: string;
  role: string;
  createdAt: string;
}
