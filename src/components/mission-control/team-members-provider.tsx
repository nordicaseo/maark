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

  useEffect(() => {
    if (!projectId) return;

    const params = new URLSearchParams();
    params.set('projectId', String(projectId));
    const url = `/api/team/members?${params.toString()}`;
    fetch(url)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setMembers(data))
      .catch(() => setMembers([]));
  }, [projectId]);

  const getMember = useCallback(
    (id: string) => members.find((m) => m.id === id),
    [members]
  );

  const scopedMembers = projectId ? members : [];
  return (
    <TeamMembersContext.Provider value={{ members: scopedMembers, getMember, loading: false }}>
      {children}
    </TeamMembersContext.Provider>
  );
}
