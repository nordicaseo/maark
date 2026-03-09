'use client';

import type { AgentVisualIdentity } from '@/lib/activity-feed/agent-identity';
import { AgentAvatar } from './agent-avatar';

interface ThinkingIndicatorProps {
  identity: AgentVisualIdentity;
  stageName: string;
}

export function ThinkingIndicator({ identity, stageName }: ThinkingIndicatorProps) {
  return (
    <div
      className="flex items-center gap-2 px-3 py-2 rounded-md border"
      style={{
        borderColor: 'var(--mc-border)',
        background: 'color-mix(in srgb, var(--mc-progress) 4%, transparent)',
      }}
    >
      <AgentAvatar identity={identity} size="sm" isActive />
      <span
        className="text-[11px] font-medium"
        style={{ color: 'var(--mc-text-secondary)' }}
      >
        {identity.displayRole} is working on {stageName}
      </span>
      <span className="mc-thinking-dots" style={{ color: 'var(--mc-progress)' }}>
        <span className="mc-thinking-dot" />
        <span className="mc-thinking-dot" />
        <span className="mc-thinking-dot" />
      </span>
    </div>
  );
}
