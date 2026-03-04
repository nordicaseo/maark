'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';

export interface TeamMember {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  role: string;
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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams();
    if (projectId) params.set('projectId', String(projectId));
    const url = params.size > 0 ? `/api/team/members?${params.toString()}` : '/api/team/members';
    fetch(url)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setMembers(data))
      .catch(() => setMembers([]))
      .finally(() => setLoading(false));
  }, [projectId]);

  const getMember = useCallback(
    (id: string) => members.find((m) => m.id === id),
    [members]
  );

  return (
    <TeamMembersContext.Provider value={{ members, getMember, loading }}>
      {children}
    </TeamMembersContext.Provider>
  );
}
