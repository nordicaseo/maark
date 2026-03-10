'use client';

import { useParams } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { MainLayout } from '@/components/layout/main-layout';

export default function DocumentPage() {
  const params = useParams();
  const id = params?.id ? parseInt(String(params.id), 10) : undefined;

  return (
    <MainLayout variant="editor">
      <AppShell documentId={id} />
    </MainLayout>
  );
}
