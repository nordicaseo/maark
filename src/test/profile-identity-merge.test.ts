import { describe, expect, it } from 'vitest';
import {
  resolveProfileIdentityForCreate,
  resolveProfileIdentityForUpdate,
} from '@/lib/agents/profile-identity-merge';

const defaults = {
  displayName: 'Atlas Blog',
  emoji: '✍️',
  mission: 'Default mission',
};

describe('profile identity merge', () => {
  it('uses defaults on create when fields are omitted', () => {
    const created = resolveProfileIdentityForCreate({
      input: {},
      defaults,
    });
    expect(created).toEqual(defaults);
  });

  it('preserves existing values when update fields are omitted', () => {
    const merged = resolveProfileIdentityForUpdate({
      input: {},
      existing: {
        displayName: 'Paul Blog',
        emoji: '✍️',
        mission: 'Paul mission',
      },
      defaults,
    });
    expect(merged).toEqual({
      displayName: 'Paul Blog',
      emoji: '✍️',
      mission: 'Paul mission',
    });
  });

  it('applies explicit updates and normalizes blank values to defaults', () => {
    const merged = resolveProfileIdentityForUpdate({
      input: {
        displayName: '  ',
        emoji: '🧠',
        mission: 'Updated mission',
      },
      existing: {
        displayName: 'Paul Blog',
        emoji: '✍️',
        mission: 'Paul mission',
      },
      defaults,
    });
    expect(merged).toEqual({
      displayName: 'Atlas Blog',
      emoji: '🧠',
      mission: 'Updated mission',
    });
  });
});
