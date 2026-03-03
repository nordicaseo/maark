import { NextRequest } from 'next/server';
import { getProviderForAction } from '@/lib/ai';

const SKILL_GENERATION_SYSTEM = `You are an expert at creating AI writing skill documents. Generate a detailed, structured skill in this markdown format:

---
name: [kebab-case-name]
description: [1-2 sentence description]
---

# [Skill Title]

## What This Skill Does
[Clear description of what content this skill helps create]

## Company/Brand Overview
[Brand info, key signals, audience, positioning]

## Brand Voice
[Voice attributes, tone guidelines, language to use/avoid]

## Content Structure
[Detailed content zones/sections with instructions for each]

## Keyword Handling Rules
[SEO and keyword integration instructions]

## What NOT to Do
[Anti-patterns and things to avoid]

Make it specific, actionable, and detailed enough to guide an AI writer to produce consistent, high-quality content.`;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { description } = body;

    if (!description) {
      return new Response(
        JSON.stringify({ error: 'description is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { provider, model, maxTokens, temperature } = await getProviderForAction('skill_generation');

    const stream = provider.stream({
      system: SKILL_GENERATION_SYSTEM,
      messages: [
        {
          role: 'user',
          content: `Generate a detailed writing skill based on this description:\n\n${description}`,
        },
      ],
      model,
      maxTokens,
      temperature,
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Transfer-Encoding': 'chunked',
        'Cache-Control': 'no-cache',
      },
    });
  } catch (error) {
    console.error('Error generating skill:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to generate skill' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
