import { describe, expect, it } from 'vitest';
import {
  findSkillScopeViolations,
  isSkillScopedToProject,
} from '@/lib/workflow/skill-scope';

describe('skill scope guardrails', () => {
  it('accepts project-scoped skills for same project', () => {
    expect(
      isSkillScopedToProject({ projectId: 42, isGlobal: 0 }, 42)
    ).toBe(true);
  });

  it('rejects project-scoped skills from another project', () => {
    expect(
      isSkillScopedToProject({ projectId: 7, isGlobal: 0 }, 42)
    ).toBe(false);
  });

  it('accepts global skills across projects', () => {
    expect(
      isSkillScopedToProject({ projectId: null, isGlobal: 1 }, 42)
    ).toBe(true);
  });

  it('flags missing and out-of-scope skill ids', () => {
    const result = findSkillScopeViolations({
      projectId: 99,
      requestedSkillIds: [1, 2, 3],
      availableSkills: [
        { id: 1, projectId: 99, isGlobal: 0 },
        { id: 2, projectId: 10, isGlobal: 0 },
      ],
    });
    expect(result.missingSkillIds).toEqual([3]);
    expect(result.outOfScopeSkillIds).toEqual([2]);
  });
});
