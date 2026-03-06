'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';

export interface TeamMember {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  role: string;
  isOnline?: boolean;
  lastSeenAt?: string | null;
  onlineSeconds?: number;
  activeSeconds?: number;
  activityRatio?: number;
  heartbeatCount?: number;
}

interface TeamMembersContextValue {
  members: TeamMember[];
  getMember: (id: string) => TeamMember | undefined;
  loading: boolean;
}

const TeamMembersContext = createContext<TeamMembersContextValue>({
  members: [],
  getMember: () => undefined,
  loading: true,
});

export function useTeamMembers() {
  return useContext(TeamMembersContext);
}

export function TeamMembersProvider({
  children,
  projectId,
}: {
  children: React.ReactNode;
  projectId?: number | null;
}) {
  const [members, setMembers] = useState<TeamMember[]>([]);

  useEffect(() => {
    let cancelled = false;
    const loadMembers = async () => {
      const params = new URLSearchParams();
      if (projectId) params.set('projectId', String(projectId));
      const query = params.toString();
      const url = query ? `/api/team/members?${query}` : '/api/team/members';
      try {
        const res = await fetch(url);
        const data = res.ok ? await res.json() : [];
        if (!cancelled) {
          setMembers(Array.isArray(data) ? data : []);
        }
      } catch {
        if (!cancelled) setMembers([]);
      }
    };

    void loadMembers();
    const interval = window.setInterval(() => {
      void loadMembers();
    }, 20_000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [projectId]);

  const getMember = useCallback(
    (id: string) => members.find((m) => m.id === id),
    [members]
  );

  return (
    <TeamMembersContext.Provider value={{ members, getMember, loading: false }}>
      {children}
    </TeamMembersContext.Provider>
  );
}
