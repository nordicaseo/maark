export interface SkillScopeRecord {
  id: number;
  projectId: number | null;
  isGlobal?: number | boolean | null;
}

function toNullableProjectId(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function isGlobal(value: unknown): boolean {
  return value === true || value === 1 || String(value).trim() === '1';
}

export function isSkillScopedToProject(
  skill: Pick<SkillScopeRecord, 'projectId' | 'isGlobal'> | null | undefined,
  projectId: number | null | undefined
): boolean {
  if (!skill) return false;
  if (isGlobal(skill.isGlobal)) return true;

  const scopedProjectId = toNullableProjectId(projectId);
  const skillProjectId = toNullableProjectId(skill.projectId);
  if (scopedProjectId === null) return skillProjectId === null;
  return skillProjectId === scopedProjectId;
}

export function findSkillScopeViolations(args: {
  projectId: number | null | undefined;
  requestedSkillIds: number[];
  availableSkills: SkillScopeRecord[];
}): { missingSkillIds: number[]; outOfScopeSkillIds: number[] } {
  const wanted = new Set(args.requestedSkillIds);
  const seen = new Set<number>();
  const outOfScopeSkillIds: number[] = [];

  for (const skill of args.availableSkills) {
    if (!wanted.has(skill.id)) continue;
    seen.add(skill.id);
    if (!isSkillScopedToProject(skill, args.projectId)) {
      outOfScopeSkillIds.push(skill.id);
    }
  }

  const missingSkillIds = args.requestedSkillIds.filter((id) => !seen.has(id));
  return {
    missingSkillIds,
    outOfScopeSkillIds,
  };
}
