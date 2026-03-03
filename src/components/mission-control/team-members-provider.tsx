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

export function TeamMembersProvider({ children }: { children: React.ReactNode }) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/team/members')
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setMembers(data))
      .catch(() => setMembers([]))
      .finally(() => setLoading(false));
  }, []);

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
