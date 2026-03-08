import { describe, expect, it } from 'vitest';
import { normalizeId, resolveTrustedAgentId } from '@/lib/workflow/agent-scope';

describe('agent scope resolver', () => {
  it('normalizes ids', () => {
    expect(normalizeId(' agent_1 ')).toBe('agent_1');
    expect(normalizeId('')).toBeNull();
    expect(normalizeId(undefined)).toBeNull();
  });

  it('uses assigned agent when request omits agent id', () => {
    expect(resolveTrustedAgentId({ assignedAgentId: 'agent_1' })).toBe('agent_1');
  });

  it('allows requested agent only when it matches assigned task agent', () => {
    expect(
      resolveTrustedAgentId({
        requestedAgentId: 'agent_1',
        assignedAgentId: 'agent_1',
      })
    ).toBe('agent_1');
  });

  it('rejects requested agent when it does not match task assignment', () => {
    expect(
      resolveTrustedAgentId({
        requestedAgentId: 'agent_other',
        assignedAgentId: 'agent_1',
      })
    ).toBeNull();
  });
});
