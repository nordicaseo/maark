import { NextRequest, NextResponse } from 'next/server';
import { getProviderForAction } from '@/lib/ai';

const STRUCTURED_SYSTEM = `You are an expert at analyzing brand documents and creating structured writing skill parts. You will receive text content extracted from uploaded files. Analyze thoroughly and return a JSON object with structured skill parts.

Return ONLY valid JSON. No markdown fences. Structure:
{
  "skillName": "Brand Name Content Skill",
  "skillDescription": "Writing skill generated from uploaded documents",
  "parts": [
    { "partType": "brand_voice", "label": "Brand Voice", "content": "..." },
    { "partType": "technical_details", "label": "Technical Details", "content": "..." },
    { "partType": "brand_history", "label": "Brand History", "content": "..." },
    { "partType": "content_structure", "label": "Content Structure", "content": "..." },
    { "partType": "keywords", "label": "Keyword Guidelines", "content": "..." },
    { "partType": "tone_guidelines", "label": "Tone Guidelines", "content": "..." }
  ]
}

partType must be one of: brand_voice, technical_details, brand_history, content_structure, keywords, tone_guidelines, custom.
Only include parts where you have enough information. Be specific and use examples from the source material.`;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const files = formData.getAll('files') as File[];
    const description = formData.get('description') as string | null;

    if (!files || files.length === 0) {
      return NextResponse.json({ error: 'At least one file is required' }, { status: 400 });
    }

    const texts: string[] = [];

    for (const file of files.slice(0, 10)) {
      const name = file.name.toLowerCase();

      // Only support text-based files
      if (name.endsWith('.txt') || name.endsWith('.md') || name.endsWith('.markdown') || name.endsWith('.csv')) {
        const text = await file.text();
        if (text.length > 50) {
          const truncated = text.length > 10000 ? text.slice(0, 10000) + '\n\n[Content truncated...]' : text;
          texts.push(`--- Content from ${file.name} ---\n\n${truncated}`);
        }
      } else {
        // Skip unsupported file types
        texts.push(`--- File ${file.name} skipped (unsupported format, only .txt/.md supported) ---`);
      }
    }

    if (texts.filter(t => !t.includes('skipped')).length === 0) {
      return NextResponse.json({
        error: 'No text content could be extracted. Supported formats: .txt, .md',
      }, { status: 400 });
    }

    const combinedText = texts.join('\n\n').slice(0, 20000);
    const descriptionNote = description ? `\n\nAdditional context: ${description}` : '';

    const { provider, model, maxTokens, temperature } = await getProviderForAction('skill_generation');

    const stream = provider.stream({
      system: STRUCTURED_SYSTEM,
      messages: [
        {
          role: 'user',
          content: `Analyze the following document content and return structured skill parts as JSON:\n\n${combinedText}${descriptionNote}`,
        },
      ],
      model,
      maxTokens: Math.max(maxTokens, 4096),
      temperature,
    });

    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      fullText += decoder.decode(value, { stream: true });
    }

    try {
      const jsonStr = fullText.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
      const parsed = JSON.parse(jsonStr);
      return NextResponse.json(parsed);
    } catch {
      return NextResponse.json({
        skillName: 'Generated Skill',
        skillDescription: `Generated from ${files.length} file(s)`,
        parts: [
          {
            partType: 'custom',
            label: 'Generated Content',
            content: fullText,
          },
        ],
      });
    }
  } catch (error: any) {
    console.error('Error generating skill from files:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to process files' },
      { status: 500 }
    );
  }
}
