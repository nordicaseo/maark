import { afterEach, describe, expect, it } from 'vitest';
import { strictProjectAgentPoolsEnabled } from '@/lib/agents/runtime-agent-pools';

const ORIGINAL_MODE = process.env.PROJECT_AGENT_POOL_MODE;

afterEach(() => {
  process.env.PROJECT_AGENT_POOL_MODE = ORIGINAL_MODE;
});

describe('project agent pool mode', () => {
  it('defaults to strict mode', () => {
    delete process.env.PROJECT_AGENT_POOL_MODE;
    expect(strictProjectAgentPoolsEnabled()).toBe(true);
  });

  it('turns off strict routing for legacy/shared/global modes', () => {
    process.env.PROJECT_AGENT_POOL_MODE = 'legacy';
    expect(strictProjectAgentPoolsEnabled()).toBe(false);
    process.env.PROJECT_AGENT_POOL_MODE = 'shared';
    expect(strictProjectAgentPoolsEnabled()).toBe(false);
  });
});
