'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function AdminSkillsRetiredPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Skills Retired</h1>
      <p className="text-sm text-muted-foreground">
        Standalone Skills has been retired. Use project-scoped Agent Knowledge in Super Admin.
      </p>
      <Button asChild>
        <Link href="/super-admin/agents">Open Agents</Link>
      </Button>
    </div>
  );
}
