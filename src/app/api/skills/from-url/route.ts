import { NextRequest } from 'next/server';
import { getProviderForAction } from '@/lib/ai';

const SKILL_FROM_URL_SYSTEM = `You are an expert at analyzing websites and creating AI writing skill documents. You will receive the extracted text content from a website. Analyze it thoroughly to understand:

- The brand identity, tone, and positioning
- Products or services offered
- Target audience
- Content style and patterns
- Key terminology and language

Then generate a detailed, structured skill document in this markdown format:

# [Brand/Company Name] Content Skill

## What This Skill Does
[Clear description of what content this skill helps create for this brand]

## Company/Brand Overview
[Key details: what they do, their market position, target audience, unique selling points]

## Brand Voice
[Specific voice attributes, tone guidelines, language patterns observed on the site]
- Tone: [e.g., professional but approachable]
- Language style: [e.g., uses industry jargon, keeps it simple]
- Words/phrases to use: [observed patterns]
- Words/phrases to avoid: [things that don't fit the brand]

## Product/Service Knowledge
[Key products, services, features, or topics the brand covers — extracted from the site]

## Content Structure Guidelines
[How content should be organized based on patterns observed on the site]

## SEO & Keyword Handling
[Guidelines for keyword integration based on how the site handles SEO]

## What NOT to Do
[Anti-patterns: things that would be off-brand or inconsistent]

Make the skill specific, actionable, and detailed. Use concrete examples from the site content where possible.`;

async function extractText(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Maark/1.0; +https://maark.vercel.app)',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const html = await res.text();

    // Basic HTML-to-text: strip tags, decode entities, collapse whitespace
    let text = html
      // Remove script/style/head blocks
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<head[\s\S]*?<\/head>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '')
      .replace(/<footer[\s\S]*?<\/footer>/gi, '')
      // Convert block tags to newlines
      .replace(/<\/?(p|div|br|h[1-6]|li|tr|blockquote|section|article)[^>]*>/gi, '\n')
      // Strip remaining tags
      .replace(/<[^>]+>/g, ' ')
      // Decode common entities
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      // Collapse whitespace
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n/g, '\n\n')
      .trim();

    // Limit to ~12000 chars to stay within context
    if (text.length > 12000) {
      text = text.slice(0, 12000) + '\n\n[Content truncated...]';
    }

    return text;
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json();

    if (!url || typeof url !== 'string') {
      return new Response(
        JSON.stringify({ error: 'URL is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Validate URL
    let parsed: URL;
    try {
      parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
    } catch {
      return new Response(
        JSON.stringify({ error: 'Invalid URL' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return new Response(
        JSON.stringify({ error: 'Only HTTP/HTTPS URLs are supported' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Extract text from URL
    const siteText = await extractText(parsed.href);

    if (siteText.length < 50) {
      return new Response(
        JSON.stringify({ error: 'Could not extract enough content from this URL' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { provider, model, maxTokens, temperature } = await getProviderForAction('skill_generation');

    const stream = provider.stream({
      system: SKILL_FROM_URL_SYSTEM,
      messages: [
        {
          role: 'user',
          content: `Analyze this website content and generate a detailed writing skill:\n\nURL: ${parsed.href}\n\n--- EXTRACTED SITE CONTENT ---\n\n${siteText}`,
        },
      ],
      model,
      maxTokens: Math.max(maxTokens, 4096),
      temperature,
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Transfer-Encoding': 'chunked',
        'Cache-Control': 'no-cache',
      },
    });
  } catch (error: unknown) {
    console.error('Error generating skill from URL:', error);
    const message = (error as { message?: string })?.message;
    return new Response(
      JSON.stringify({ error: message || 'Failed to generate skill from URL' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
