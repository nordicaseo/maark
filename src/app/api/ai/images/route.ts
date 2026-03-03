import { NextRequest } from 'next/server';
import OpenAI from 'openai';

export async function POST(req: NextRequest) {
  try {
    const { prompt, style, size } = await req.json();

    if (!prompt || typeof prompt !== 'string') {
      return Response.json({ error: 'Prompt is required' }, { status: 400 });
    }

    // Try OPENAI_API_KEY first, then check DB providers
    let apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
      // Try to get from DB
      const { db, ensureDb } = await import('@/db/index');
      const { aiProviders } = await import('@/db/schema');
      const { eq } = await import('drizzle-orm');
      await ensureDb();

      const providers = await db
        .select()
        .from(aiProviders)
        .where(eq(aiProviders.name, 'openai'))
        .limit(1);

      if (providers.length > 0) {
        apiKey = providers[0].apiKey;
      }
    }

    if (!apiKey) {
      return Response.json(
        { error: 'OpenAI API key not configured. Add an OpenAI provider in Admin > AI Models or set OPENAI_API_KEY.' },
        { status: 400 }
      );
    }

    const openai = new OpenAI({ apiKey });

    const stylePrompt = style === 'photographic'
      ? 'Create a photorealistic image: '
      : style === 'illustration'
        ? 'Create a clean, modern illustration: '
        : style === 'minimal'
          ? 'Create a minimalist, clean design: '
          : '';

    const response = await openai.images.generate({
      model: 'dall-e-3',
      prompt: `${stylePrompt}${prompt}`,
      n: 1,
      size: size || '1792x1024',
      quality: 'standard',
    });

    const imageUrl = response.data?.[0]?.url;
    const revisedPrompt = response.data?.[0]?.revised_prompt;

    if (!imageUrl) {
      return Response.json({ error: 'No image generated' }, { status: 500 });
    }

    return Response.json({ url: imageUrl, revisedPrompt });
  } catch (error: any) {
    console.error('Image generation error:', error);

    if (error?.status === 400) {
      return Response.json(
        { error: 'Image generation was rejected. Try a different prompt.' },
        { status: 400 }
      );
    }

    return Response.json(
      { error: error?.message || 'Image generation failed' },
      { status: 500 }
    );
  }
}
