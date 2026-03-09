'use client';

import { useState } from 'react';
import { useQuery, useMutation } from 'convex/react';
import { api } from '../../../convex/_generated/api';
import { useAuth } from '@/components/auth/auth-provider';
import {
  Activity,
  MessageCircle,
  Bot,
  User,
  Send,
} from 'lucide-react';
import { WorkflowActivityFeed } from './workflow-feed/workflow-activity-feed';

interface ActivitySidebarProps {
  projectId: number | null;
}

// ── Helpers ──────────────────────────────────────────────────────

function relativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

// ── Main Component ───────────────────────────────────────────────

export function ActivitySidebar({ projectId }: ActivitySidebarProps) {
  const [tab, setTab] = useState<'activity' | 'messages'>('activity');
  const { user } = useAuth();

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--mc-surface-alt)' }}>
      {/* Tab switcher */}
      <div className="flex border-b px-3 pt-3" style={{ borderColor: 'var(--mc-border)' }}>
        <button
          onClick={() => setTab('activity')}
          className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
            tab === 'activity'
              ? 'border-[var(--mc-accent)] text-[var(--mc-text-primary)]'
              : 'border-transparent text-[var(--mc-text-tertiary)]'
          }`}
        >
          <Activity className="h-3.5 w-3.5" />
          Activity
        </button>
        <button
          onClick={() => setTab('messages')}
          className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
            tab === 'messages'
              ? 'border-[var(--mc-accent)] text-[var(--mc-text-primary)]'
              : 'border-transparent text-[var(--mc-text-tertiary)]'
          }`}
        >
          <MessageCircle className="h-3.5 w-3.5" />
          Messages
        </button>
      </div>

      {tab === 'activity' ? (
        <WorkflowActivityFeed projectId={projectId} />
      ) : (
        <MessagesFeed projectId={projectId} user={user} />
      )}
    </div>
  );
}

// ── Messages Feed ────────────────────────────────────────────────

interface MessagesFeedProps {
  projectId: number | null;
  user: { id: string; name: string | null; email: string } | null;
}

function MessagesFeed({ projectId, user }: MessagesFeedProps) {
  const [draft, setDraft] = useState('');
  const messages = useQuery(
    api.messages.list,
    projectId ? { projectId, limit: 120 } : 'skip'
  );
  const sendMessage = useMutation(api.messages.send);
  const createActivity = useMutation(api.activities.create);

  if (!projectId) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <p className="text-xs" style={{ color: 'var(--mc-text-tertiary)' }}>
          Select a project to load messages.
        </p>
      </div>
    );
  }

  const handleSend = async () => {
    if (!draft.trim() || !user) return;

    const content = draft.trim();
    setDraft('');

    await sendMessage({
      projectId: projectId ?? undefined,
      authorType: 'user',
      authorId: user.id,
      authorName: user.name || user.email,
      content,
    });

    await createActivity({
      type: 'message',
      description: `${user.name || user.email}: "${content.length > 60 ? content.slice(0, 60) + '...' : content}"`,
      projectId: projectId ?? undefined,
      userId: user.id,
      userName: user.name || user.email,
    });
  };

  // Reverse the desc-ordered list so messages appear chronologically (oldest first)
  const sortedMessages = messages ? [...messages].reverse() : null;

  if (!sortedMessages) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <div
          className="text-xs animate-pulse"
          style={{ color: 'var(--mc-text-tertiary)' }}
        >
          Loading messages...
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Message list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {sortedMessages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center mb-3"
              style={{ background: 'var(--mc-overlay, #f3f3f0)' }}
            >
              <MessageCircle className="h-5 w-5" style={{ color: 'var(--mc-text-tertiary)' }} />
            </div>
            <p className="text-xs" style={{ color: 'var(--mc-text-tertiary)' }}>
              No messages yet
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--mc-text-tertiary)' }}>
              Start a conversation about this project.
            </p>
          </div>
        ) : (
          sortedMessages.map((msg) => {
            const isAgent = msg.authorType === 'agent';
            return (
              <div key={msg._id} className={`flex ${isAgent ? 'justify-start' : 'justify-end'}`}>
                <div
                  className="max-w-[85%] rounded-lg px-3 py-2"
                  style={{
                    background: isAgent
                      ? 'var(--mc-overlay, #f3f3f0)'
                      : 'var(--mc-accent)',
                    color: isAgent
                      ? 'var(--mc-text-primary)'
                      : '#fff',
                  }}
                >
                  <div
                    className="text-[10px] font-medium mb-0.5"
                    style={{
                      color: isAgent
                        ? 'var(--mc-text-tertiary)'
                        : 'rgba(255,255,255,0.7)',
                    }}
                  >
                    {isAgent && <Bot className="inline h-3 w-3 mr-1 -mt-0.5" />}
                    {!isAgent && <User className="inline h-3 w-3 mr-1 -mt-0.5" />}
                    {msg.authorName}
                  </div>
                  <p className="text-xs leading-relaxed">{msg.content}</p>
                  <p
                    className="text-[10px] mt-1 text-right"
                    style={{
                      color: isAgent
                        ? 'var(--mc-text-tertiary)'
                        : 'rgba(255,255,255,0.6)',
                    }}
                  >
                    {relativeTime(msg.createdAt)}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Input */}
      <div
        className="border-t p-3"
        style={{ borderColor: 'var(--mc-border)' }}
      >
        <div className="flex gap-2">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Type a message..."
            className="flex-1 text-xs rounded-md border px-3 py-2 outline-none transition-colors"
            style={{
              borderColor: 'var(--mc-border)',
              background: 'var(--mc-surface)',
              color: 'var(--mc-text-primary)',
            }}
          />
          <button
            onClick={handleSend}
            disabled={!draft.trim()}
            className="shrink-0 rounded-md px-3 py-2 transition-opacity disabled:opacity-40"
            style={{ background: 'var(--mc-accent)', color: '#fff' }}
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
