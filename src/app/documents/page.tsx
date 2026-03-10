'use client';

import { AppShell } from '@/components/layout/app-shell';
import { MainLayout } from '@/components/layout/main-layout';

export default function DocumentsPage() {
  return (
    <MainLayout variant="editor">
      <AppShell />
    </MainLayout>
  );
}
