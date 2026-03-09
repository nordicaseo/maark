export type ProfileIdentity = {
  displayName: string;
  emoji: string;
  mission: string;
};

export type ProfileIdentityInput = {
  displayName?: string | null;
  emoji?: string | null;
  mission?: string | null;
};

function normalizeTrimmedInput(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() : undefined;
}

export function resolveProfileIdentityForCreate(args: {
  input: ProfileIdentityInput;
  defaults: ProfileIdentity;
}): ProfileIdentity {
  const displayName = normalizeTrimmedInput(args.input.displayName) || args.defaults.displayName;
  const emoji = normalizeTrimmedInput(args.input.emoji) || args.defaults.emoji;
  const mission = normalizeTrimmedInput(args.input.mission) || args.defaults.mission;
  return { displayName, emoji, mission };
}

export function resolveProfileIdentityForUpdate(args: {
  input: ProfileIdentityInput;
  existing: {
    displayName: string;
    emoji: string | null;
    mission: string | null;
  };
  defaults: ProfileIdentity;
}): ProfileIdentity {
  const displayNameInput = normalizeTrimmedInput(args.input.displayName);
  const emojiInput = normalizeTrimmedInput(args.input.emoji);
  const missionInput = normalizeTrimmedInput(args.input.mission);
  return {
    displayName:
      displayNameInput !== undefined
        ? displayNameInput || args.defaults.displayName
        : args.existing.displayName,
    emoji:
      emojiInput !== undefined
        ? emojiInput || args.defaults.emoji
        : args.existing.emoji || args.defaults.emoji,
    mission:
      missionInput !== undefined
        ? missionInput || args.defaults.mission
        : args.existing.mission || args.defaults.mission,
  };
}
