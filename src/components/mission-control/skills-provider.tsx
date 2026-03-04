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

export function SkillsProvider({ children }: { children: React.ReactNode }) {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/skills')
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setSkills(data))
      .catch(() => setSkills([]))
      .finally(() => setLoading(false));
  }, []);

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
