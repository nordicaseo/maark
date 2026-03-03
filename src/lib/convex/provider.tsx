'use client';

import { ConvexProvider, ConvexReactClient } from 'convex/react';
import { ReactNode, createContext, useContext, useMemo } from 'react';

const ConvexAvailableContext = createContext(false);

export function useConvexAvailable() {
  return useContext(ConvexAvailableContext);
}

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  const convex = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_CONVEX_URL;
    if (!url) return null;
    return new ConvexReactClient(url);
  }, []);

  if (!convex) {
    // Convex not configured — render children without provider
    return (
      <ConvexAvailableContext.Provider value={false}>
        {children}
      </ConvexAvailableContext.Provider>
    );
  }

  return (
    <ConvexAvailableContext.Provider value={true}>
      <ConvexProvider client={convex}>{children}</ConvexProvider>
    </ConvexAvailableContext.Provider>
  );
}
