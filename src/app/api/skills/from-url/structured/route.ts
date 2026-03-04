import { NextRequest, NextResponse } from 'next/server';
import { getProviderForAction } from '@/lib/ai';
import { requireRole } from '@/lib/auth';
import { userCanAccessProject } from '@/lib/access';
import { logAuditEvent } from '@/lib/observability';

const STRUCTURED_SYSTEM = `You are an expert at analyzing websites and extracting structured brand information. You will receive text content from one or more web pages. Analyze thoroughly and return a JSON array of skill parts.

Each part has:
- partType: one of "brand_voice", "technical_details", "brand_history", "content_structure", "keywords", "tone_guidelines"
- label: a descriptive label for this section
- content: detailed markdown content for this section

Return ONLY valid JSON. No markdown fences. Structure:
{
  "skillName": "Brand Name Content Skill",
  "skillDescription": "Writing skill generated from website analysis",
  "parts": [
    { "partType": "brand_voice", "label": "Brand Voice", "content": "..." },
    { "partType": "technical_details", "label": "Technical Details", "content": "..." },
    { "partType": "brand_history", "label": "Brand History", "content": "..." },
    { "partType": "content_structure", "label": "Content Structure", "content": "..." },
    { "partType": "keywords", "label": "Keyword Guidelines", "content": "..." },
    { "partType": "tone_guidelines", "label": "Tone Guidelines", "content": "..." }
  ]
}

Only include parts where you have enough information. Each part's content should be specific, actionable, and use concrete examples from the site.`;

async function extractText(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Maark/1.0; +https://maark.vercel.app)',
        Accept: 'text/html,application/xhtml+xml',
      },
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const html = await res.text();
    let text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<head[\s\S]*?<\/head>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, '')
      .replace(/<\/?(p|div|br|h[1-6]|li|tr|blockquote|section|article)[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n/g, '\n\n')
      .trim();

    if (text.length > 12000) {
      text = text.slice(0, 12000) + '\n\n[Content truncated...]';
    }

    return text;
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireRole('editor');
  if (auth.error) return auth.error;

  try {
    const { urls, description, projectId } = await req.json() as { urls: string[]; description?: string; projectId?: number };

    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return NextResponse.json({ error: 'At least one URL is required' }, { status: 400 });
    }
    if (
      projectId !== undefined &&
      projectId !== null &&
      !(await userCanAccessProject(auth.user, Number(projectId)))
    ) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Extract text from all URLs (limit to 5)
    const urlsToProcess = urls.slice(0, 5);
    const texts: string[] = [];

    for (const url of urlsToProcess) {
      try {
        const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
        const text = await extractText(parsed.href);
        if (text.length > 50) {
          texts.push(`--- Content from ${parsed.href} ---\n\n${text}`);
        }
      } catch {
        // Skip failed URLs
      }
    }

    if (texts.length === 0) {
      return NextResponse.json({ error: 'Could not extract content from any of the provided URLs' }, { status: 400 });
    }

    const combinedText = texts.join('\n\n').slice(0, 20000);
    const descriptionNote = description ? `\n\nAdditional context from the user: ${description}` : '';

    const { provider, model, maxTokens, temperature } = await getProviderForAction('skill_generation');

    const stream = provider.stream({
      system: STRUCTURED_SYSTEM,
      messages: [
        {
          role: 'user',
          content: `Analyze the following website content and return structured skill parts as JSON:\n\n${combinedText}${descriptionNote}`,
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
      // Handle case where AI wraps in markdown code fences
      const jsonStr = fullText.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
      const parsed = JSON.parse(jsonStr);
      await logAuditEvent({
        userId: auth.user.id,
        action: 'skills.from_url.structured',
        resourceType: 'skill',
        projectId: projectId ?? null,
        metadata: { urlCount: urlsToProcess.length, extractedSourceCount: texts.length, partsCount: Array.isArray(parsed?.parts) ? parsed.parts.length : null },
      });
      return NextResponse.json(parsed);
    } catch {
      // Fallback: return raw text as a single custom part
      await logAuditEvent({
        userId: auth.user.id,
        action: 'skills.from_url.structured',
        resourceType: 'skill',
        projectId: projectId ?? null,
        metadata: { urlCount: urlsToProcess.length, extractedSourceCount: texts.length, fallback: true, partsCount: 1 },
      });
      return NextResponse.json({
        skillName: 'Generated Skill',
        skillDescription: `Generated from ${urlsToProcess.length} URL(s)`,
        parts: [
          {
            partType: 'custom',
            label: 'Generated Content',
            content: fullText,
          },
        ],
      });
    }
  } catch (error: unknown) {
    console.error('Error generating structured skill:', error);
    const message = (error as { message?: string })?.message;
    return NextResponse.json(
      { error: message || 'Failed to generate skill' },
      { status: 500 }
    );
  }
}
