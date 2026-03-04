'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';

export interface Skill {
  id: number;
  name: string;
}

interface SkillsContextValue {
  skills: Skill[];
  getSkillName: (id: number) => string | undefined;
  loading: boolean;
}

const SkillsContext = createContext<SkillsContextValue>({
  skills: [],
  getSkillName: () => undefined,
  loading: true,
});

export function useSkills() {
  return useContext(SkillsContext);
}

export function SkillsProvider({
  children,
  projectId,
}: {
  children: React.ReactNode;
  projectId?: number | null;
}) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams();
    if (projectId) params.set('projectId', String(projectId));
    const url = params.size > 0 ? `/api/skills?${params.toString()}` : '/api/skills';
    fetch(url)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setSkills(data))
      .catch(() => setSkills([]))
      .finally(() => setLoading(false));
  }, [projectId]);

  const getSkillName = useCallback(
    (id: number) => skills.find((s) => s.id === id)?.name,
    [skills]
  );

  return (
    <SkillsContext.Provider value={{ skills, getSkillName, loading }}>
      {children}
    </SkillsContext.Provider>
  );
}
