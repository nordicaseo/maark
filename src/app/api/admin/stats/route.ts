import { NextResponse } from 'next/server';
import { db, ensureDb } from '@/db/index';
import { documents, projects, users, aiProviders, keywords, pages } from '@/db/schema';
import { sql } from 'drizzle-orm';
import { requireRole } from '@/lib/auth';

export async function GET() {
  await ensureDb();

  const auth = await requireRole('admin');
  if (auth.error) return auth.error;
  const [docCount] = await db.select({ count: sql<number>`count(*)` }).from(documents);
  const [projCount] = await db.select({ count: sql<number>`count(*)` }).from(projects);
  const [userCount] = await db.select({ count: sql<number>`count(*)` }).from(users);
  const [provCount] = await db.select({ count: sql<number>`count(*)` }).from(aiProviders);
  const [keywordCount] = await db.select({ count: sql<number>`count(*)` }).from(keywords);
  const [pageCount] = await db.select({ count: sql<number>`count(*)` }).from(pages);
  return NextResponse.json({
    documents: Number(docCount?.count ?? 0),
    projects: Number(projCount?.count ?? 0),
    users: Number(userCount?.count ?? 0),
    providers: Number(provCount?.count ?? 0),
    keywords: Number(keywordCount?.count ?? 0),
    pages: Number(pageCount?.count ?? 0),
  });
}
