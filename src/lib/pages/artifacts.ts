import * as cheerio from 'cheerio';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { pageArtifacts, taskPageLinks } from '@/db/schema';
import { readArtifactContentFromWorker } from '@/lib/crawler/artifact-worker';

export interface ResolvedPageCleanContent {
  pageId: number;
  snapshotId: number;
  artifactId: number;
  objectKey: string;
  html: string;
  text: string;
  headings: string[];
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractHeadings(html: string): string[] {
  const $ = cheerio.load(html);
  const headings: string[] = [];
  $('h1, h2, h3').each((_, el) => {
    const value = $(el).text().trim();
    if (!value) return;
    headings.push(value);
  });
  return headings.slice(0, 40);
}

async function getCleanArtifact(args: {
  pageId: number;
  snapshotId?: number;
}) {
  const baseWhere = args.snapshotId
    ? and(
        eq(pageArtifacts.pageId, args.pageId),
        eq(pageArtifacts.snapshotId, args.snapshotId),
        eq(pageArtifacts.artifactType, 'clean_html'),
        eq(pageArtifacts.status, 'ready')
      )
    : and(
        eq(pageArtifacts.pageId, args.pageId),
        eq(pageArtifacts.artifactType, 'clean_html'),
        eq(pageArtifacts.status, 'ready')
      );

  const [artifact] = await db
    .select()
    .from(pageArtifacts)
    .where(baseWhere)
    .orderBy(desc(pageArtifacts.createdAt))
    .limit(1);

  return artifact || null;
}

export async function resolvePageCleanContent(
  pageId: number,
  snapshotId?: number
): Promise<ResolvedPageCleanContent | null> {
  const artifact = await getCleanArtifact({ pageId, snapshotId });
  if (!artifact?.objectKey) return null;

  const loaded = await readArtifactContentFromWorker({ objectKey: artifact.objectKey });
  const html = String(loaded.content || '').trim();
  if (!html) return null;

  return {
    pageId,
    snapshotId: Number(artifact.snapshotId),
    artifactId: Number(artifact.id),
    objectKey: artifact.objectKey,
    html,
    text: htmlToText(html),
    headings: extractHeadings(html),
  };
}

export async function resolveTaskLinkedPageCleanContent(args: {
  taskId: string;
  projectId?: number | null;
}) {
  const [link] = await db
    .select({
      pageId: taskPageLinks.pageId,
    })
    .from(taskPageLinks)
    .where(
      and(
        eq(taskPageLinks.taskId, args.taskId),
        ...(args.projectId ? [eq(taskPageLinks.projectId, args.projectId)] : [])
      )
    )
    .orderBy(desc(taskPageLinks.createdAt))
    .limit(1);

  if (!link?.pageId) return null;
  return resolvePageCleanContent(Number(link.pageId));
}
