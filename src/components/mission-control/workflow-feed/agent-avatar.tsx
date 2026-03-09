'use client';

import type { AgentVisualIdentity } from '@/lib/activity-feed/agent-identity';

interface AgentAvatarProps {
  identity: AgentVisualIdentity;
  size?: 'sm' | 'md';
  isActive?: boolean;
}

export function AgentAvatar({ identity, size = 'sm', isActive }: AgentAvatarProps) {
  return (
    <div className="relative inline-flex shrink-0">
      <div
        className={`mc-agent-avatar ${size === 'md' ? 'mc-agent-avatar-md' : 'mc-agent-avatar-sm'}`}
        style={{ background: identity.bgColor, color: identity.color }}
      >
        {identity.initials}
      </div>
      {isActive && (
        <span
          className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-white"
          style={{ background: '#3a9567' }}
        />
      )}
    </div>
  );
}
