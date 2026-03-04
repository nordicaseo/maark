import { NextRequest, NextResponse } from 'next/server';
import { getProviderForAction } from '@/lib/ai';
import { requireRole } from '@/lib/auth';
import { userCanAccessProject } from '@/lib/access';
import { logAuditEvent } from '@/lib/observability';

const STRUCTURED_SYSTEM = `You are an expert at creating AI writing skill documents. Generate a detailed, structured skill with clearly separated parts.

Return ONLY valid JSON (no markdown fences). Structure:
{
  "skillName": "Descriptive Skill Name",
  "skillDescription": "1-2 sentence description of what this skill does",
  "parts": [
    { "partType": "brand_voice", "label": "Brand Voice", "content": "Tone, personality, language patterns..." },
    { "partType": "content_structure", "label": "Content Structure", "content": "Section templates, outline format..." },
    { "partType": "tone_guidelines", "label": "Tone Guidelines", "content": "Formal/casual, audience targeting..." },
    { "partType": "keywords", "label": "Keyword Guidelines", "content": "How to integrate keywords..." },
    { "partType": "technical_details", "label": "Technical Details", "content": "Product/service specifics..." },
    { "partType": "custom", "label": "What NOT to Do", "content": "Anti-patterns and things to avoid..." }
  ]
}

Guidelines:
- Each part's content should be specific, actionable, and detailed enough to guide an AI writer
- Use markdown formatting within each part's content (headings, lists, bold)
- Only include parts where you have enough information to be useful
- Always include at least: brand_voice, content_structure, and tone_guidelines
- Make it specific enough to produce consistent, high-quality content`;

export async function POST(req: NextRequest) {
  const auth = await requireRole('editor');
  if (auth.error) return auth.error;

  try {
    const body = await req.json();
    const { description, projectId } = body;

    if (!description) {
      return NextResponse.json(
        { error: 'description is required' },
        { status: 400 }
      );
    }
    if (
      projectId !== undefined &&
      projectId !== null &&
      !(await userCanAccessProject(auth.user, Number(projectId)))
    ) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { provider, model, maxTokens, temperature } = await getProviderForAction('skill_generation');

    const stream = provider.stream({
      system: STRUCTURED_SYSTEM,
      messages: [
        {
          role: 'user',
          content: `Generate a detailed, structured writing skill based on this description:\n\n${description}`,
        },
      ],
      model,
      maxTokens: Math.max(maxTokens, 4096),
      temperature,
    });

    // Collect full response to parse as JSON
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      fullText += decoder.decode(value, { stream: true });
    }

    // Try to parse JSON from the response
    try {
      const jsonStr = fullText.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
      const parsed = JSON.parse(jsonStr);
      await logAuditEvent({
        userId: auth.user.id,
        action: 'skills.generate',
        resourceType: 'skill',
        projectId: projectId ?? null,
        metadata: { descriptionLength: description.length, partsCount: Array.isArray(parsed?.parts) ? parsed.parts.length : null },
      });
      return NextResponse.json(parsed);
    } catch {
      // Fallback: split markdown by ## headings into multiple parts
      const sections = fullText.split(/^##\s+/m).filter(s => s.trim());
      if (sections.length > 1) {
        const parts = sections.map((section, i) => {
          const lines = section.trim().split('\n');
          const label = lines[0]?.trim() || `Section ${i + 1}`;
          const content = lines.slice(1).join('\n').trim();
          return { partType: 'custom', label, content };
        });
        await logAuditEvent({
          userId: auth.user.id,
          action: 'skills.generate',
          resourceType: 'skill',
          projectId: projectId ?? null,
          metadata: { descriptionLength: description.length, partsCount: parts.length, fallback: 'sections' },
        });
        return NextResponse.json({
          skillName: 'Generated Skill',
          skillDescription: description.trim(),
          parts,
        });
      }

      // Last resort: single part
      await logAuditEvent({
        userId: auth.user.id,
        action: 'skills.generate',
        resourceType: 'skill',
        projectId: projectId ?? null,
        metadata: { descriptionLength: description.length, partsCount: 1, fallback: 'single' },
      });
      return NextResponse.json({
        skillName: 'Generated Skill',
        skillDescription: description.trim(),
        parts: [{ partType: 'custom', label: 'Generated Content', content: fullText }],
      });
    }
  } catch (error: unknown) {
    console.error('Error generating skill:', error);
    const message = (error as { message?: string })?.message;
    return NextResponse.json(
      { error: message || 'Failed to generate skill' },
      { status: 500 }
    );
  }
}
