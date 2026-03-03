import { NextResponse } from 'next/server';
import { db, ensureDb } from '@/db/index';
import { documents, projects, skills, users, aiProviders } from '@/db/schema';
import { sql } from 'drizzle-orm';
import { requireRole } from '@/lib/auth';

export async function GET() {
  await ensureDb();

  const auth = await requireRole('admin');
  if (auth.error) return auth.error;
  const [docCount] = await db.select({ count: sql<number>`count(*)` }).from(documents);
  const [projCount] = await db.select({ count: sql<number>`count(*)` }).from(projects);
  const [skillCount] = await db.select({ count: sql<number>`count(*)` }).from(skills);
  const [userCount] = await db.select({ count: sql<number>`count(*)` }).from(users);
  const [provCount] = await db.select({ count: sql<number>`count(*)` }).from(aiProviders);
  return NextResponse.json({
    documents: Number(docCount?.count ?? 0),
    projects: Number(projCount?.count ?? 0),
    skills: Number(skillCount?.count ?? 0),
    users: Number(userCount?.count ?? 0),
    providers: Number(provCount?.count ?? 0),
  });
}
