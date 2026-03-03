export interface Skill {
  id: number;
  projectId: number | null;
  name: string;
  description: string | null;
  content: string;
  isGlobal: number;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
}
