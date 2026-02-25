import { AppShell } from '@/components/layout/app-shell';

export default async function DocumentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <AppShell documentId={parseInt(id, 10)} />;
}
