'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function AdminSkillDetailRetiredPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Skills Retired</h1>
      <p className="text-sm text-muted-foreground">
        Skill editing is no longer active. Manage identity and knowledge in Super Admin Agents.
      </p>
      <Button asChild>
        <Link href="/super-admin/agents">Open Agents</Link>
      </Button>
    </div>
  );
}
