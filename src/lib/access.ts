import { and, eq } from 'drizzle-orm';
import { db, ensureDb } from '@/db/index';
import { documents, keywords, pages, projectMembers, projects, skills } from '@/db/schema';
import type { AppUser } from '@/lib/auth';
import { hasRole } from '@/lib/permissions';
import { ACTIVE_PROJECT_COOKIE_KEY, parseProjectId } from '@/lib/project-context';
import type { NextRequest } from 'next/server';

export function isAdminUser(user: AppUser) {
  return hasRole(user.role, 'admin');
}

export async function getAccessibleProjectIds(user: AppUser): Promise<number[]> {
  await ensureDb();
  if (isAdminUser(user)) {
    const rows = await db.select({ id: projects.id }).from(projects);
    return rows.map((r: { id: number }) => r.id);
  }
  const rows = await db
    .select({ projectId: projectMembers.projectId })
    .from(projectMembers)
    .where(eq(projectMembers.userId, user.id));
  return rows.map((r: { projectId: number }) => r.projectId);
}

export async function userCanAccessProject(
  user: AppUser,
  projectId: number | null | undefined
): Promise<boolean> {
  if (!projectId) return true;
  await ensureDb();
  if (isAdminUser(user)) return true;
  const rows = await db
    .select({ id: projectMembers.id })
    .from(projectMembers)
    .where(
      and(
        eq(projectMembers.projectId, projectId),
        eq(projectMembers.userId, user.id)
      )
    )
    .limit(1);
  return rows.length > 0;
}

export async function userCanAccessDocument(
  user: AppUser,
  documentId: number
): Promise<boolean> {
  await ensureDb();
  if (isAdminUser(user)) return true;

  const [doc] = await db
    .select({
      id: documents.id,
      projectId: documents.projectId,
      authorId: documents.authorId,
    })
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);

  if (!doc) return false;
  if (doc.authorId === user.id) return true;
  if (!doc.projectId) return false;

  return userCanAccessProject(user, doc.projectId);
}

export async function userCanAccessSkill(
  user: AppUser,
  skillId: number,
  opts?: { write?: boolean }
): Promise<boolean> {
  await ensureDb();
  const write = opts?.write ?? false;
  if (isAdminUser(user)) return true;

  const [skill] = await db
    .select({
      id: skills.id,
      projectId: skills.projectId,
      isGlobal: skills.isGlobal,
      createdById: skills.createdById,
    })
    .from(skills)
    .where(eq(skills.id, skillId))
    .limit(1);

  if (!skill) return false;

  if (skill.isGlobal === 1) {
    // Only admin/owner can mutate global skills.
    return !write;
  }

  if (!skill.projectId) {
    // Legacy/projectless skill: allow read; writes only by creator.
    return !write || skill.createdById === user.id;
  }

  return userCanAccessProject(user, skill.projectId);
}

export async function userCanAccessKeyword(
  user: AppUser,
  keywordId: number
): Promise<boolean> {
  await ensureDb();
  if (isAdminUser(user)) return true;

  const [keyword] = await db
    .select({ projectId: keywords.projectId })
    .from(keywords)
    .where(eq(keywords.id, keywordId))
    .limit(1);

  if (!keyword) return false;
  return userCanAccessProject(user, keyword.projectId);
}

export async function userCanAccessPage(
  user: AppUser,
  pageId: number
): Promise<boolean> {
  await ensureDb();
  if (isAdminUser(user)) return true;

  const [page] = await db
    .select({ projectId: pages.projectId })
    .from(pages)
    .where(eq(pages.id, pageId))
    .limit(1);

  if (!page) return false;
  return userCanAccessProject(user, page.projectId);
}

export function getRequestedProjectId(req: NextRequest): number | null {
  const fromQuery = parseProjectId(req.nextUrl.searchParams.get('projectId'));
  if (fromQuery !== null) return fromQuery;
  const fromCookie = parseProjectId(req.cookies.get(ACTIVE_PROJECT_COOKIE_KEY)?.value ?? null);
  return fromCookie;
}
