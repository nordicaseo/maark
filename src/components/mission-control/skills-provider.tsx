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

  useEffect(() => {
    if (!projectId) return;

    const params = new URLSearchParams();
    params.set('projectId', String(projectId));
    const url = `/api/skills?${params.toString()}`;
    fetch(url)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setSkills(data))
      .catch(() => setSkills([]));
  }, [projectId]);

  const getSkillName = useCallback(
    (id: number) => skills.find((s) => s.id === id)?.name,
    [skills]
  );

  const scopedSkills = projectId ? skills : [];
  return (
    <SkillsContext.Provider value={{ skills: scopedSkills, getSkillName, loading: false }}>
      {children}
    </SkillsContext.Provider>
  );
}
