import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { documents } from '@/db/schema';
import { eq } from 'drizzle-orm';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const [doc] = await db
      .select()
      .from(documents)
      .where(eq(documents.id, parseInt(id, 10)));

    if (!doc) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json(doc);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await req.json();

    const updateData: any = { updatedAt: new Date().toISOString() };
    if (body.title !== undefined) updateData.title = body.title;
    if (body.content !== undefined) updateData.content = body.content;
    if (body.plainText !== undefined) updateData.plainText = body.plainText;
    if (body.status !== undefined) updateData.status = body.status;
    if (body.contentType !== undefined) updateData.contentType = body.contentType;
    if (body.targetKeyword !== undefined) updateData.targetKeyword = body.targetKeyword;
    if (body.wordCount !== undefined) updateData.wordCount = body.wordCount;
    if (body.aiDetectionScore !== undefined) updateData.aiDetectionScore = body.aiDetectionScore;
    if (body.aiRiskLevel !== undefined) updateData.aiRiskLevel = body.aiRiskLevel;
    if (body.semanticScore !== undefined) updateData.semanticScore = body.semanticScore;
    if (body.contentQualityScore !== undefined)
      updateData.contentQualityScore = body.contentQualityScore;

    const [doc] = await db
      .update(documents)
      .set(updateData)
      .where(eq(documents.id, parseInt(id, 10)))
      .returning();

    return NextResponse.json(doc);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await db.delete(documents).where(eq(documents.id, parseInt(id, 10)));
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
