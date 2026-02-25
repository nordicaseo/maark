import { NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

interface SignalInput {
  signalId: number;
  name: string;
  score: number;
  weight: number;
  detail: string;
  examples: string[];
}

/**
 * Build signal-specific rewriting instructions based on flagged signals.
 */
function buildSignalInstructions(signals: SignalInput[]): string {
  const flagged = signals
    .filter((s) => s.score >= 3)
    .sort((a, b) => b.score * b.weight - a.score * a.weight);

  if (flagged.length === 0) {
    return 'The content already scores well on AI detection. Make only light stylistic improvements to make it sound more natural and human.';
  }

  const instructions: string[] = [];

  for (const s of flagged) {
    switch (s.signalId) {
      case 1: // Lexical Diversity
        instructions.push(
          `LEXICAL DIVERSITY (scored ${s.score}/5): The text uses too many unique words uniformly. Reuse common words more naturally. Humans repeat words — don't use a thesaurus for every term. ${s.detail}`
        );
        break;
      case 2: // Burstiness
        instructions.push(
          `SENTENCE BURSTINESS (scored ${s.score}/5): Sentences are too uniform in length. Mix VERY short punchy sentences (3-7 words) with longer complex ones (25+ words). Create dramatic variation. Current: ${s.detail}`
        );
        break;
      case 3: // Paragraph Length Uniformity
        instructions.push(
          `PARAGRAPH LENGTH (scored ${s.score}/5): Paragraphs are too similar in size. Vary them — use some 1-2 sentence paragraphs and some 5-6 sentence ones. ${s.detail}`
        );
        break;
      case 4: // Repetitive Phrasing
        instructions.push(
          `REPETITIVE PATTERNS (scored ${s.score}/5): ${s.detail}. Rephrase these repeated structures using different syntax each time.${s.examples.length > 0 ? ' Found: ' + s.examples.slice(0, 3).join('; ') : ''}`
        );
        break;
      case 5: // Pronoun & Personal Voice
        instructions.push(
          `PERSONAL VOICE (scored ${s.score}/5): Not enough first-person perspective. Add "I", "my", "we" naturally. Share brief personal opinions or experiences. ${s.detail}`
        );
        break;
      case 6: // Punctuation Diversity
        instructions.push(
          `PUNCTUATION (scored ${s.score}/5): Too predictable punctuation. Add questions, exclamations, dashes (—), parenthetical asides, and semicolons naturally. ${s.detail}`
        );
        break;
      case 7: // Sentence Starters
        instructions.push(
          `SENTENCE STARTERS (scored ${s.score}/5): Too many sentences start the same way. Vary openings — start some with adverbs, prepositional phrases, questions, or conjunctions (And, But, So). ${s.detail}`
        );
        break;
      case 8: // Transition Overuse
        instructions.push(
          `TRANSITION OVERUSE (scored ${s.score}/5): Too many AI-typical transitions. Remove or replace words like "furthermore", "moreover", "additionally", "consequently", "however". Use simpler connectors or restructure sentences to flow without explicit transitions.${s.examples.length > 0 ? ' Found: ' + s.examples.slice(0, 5).join(', ') : ''}`
        );
        break;
      case 9: // Sentence Complexity
        instructions.push(
          `SENTENCE COMPLEXITY (scored ${s.score}/5): Sentences are too uniformly complex. Mix simple, compound, and complex sentences more naturally. Include some fragments for emphasis. ${s.detail}`
        );
        break;
      case 10: // Emotional & Subjective Language
        instructions.push(
          `EMOTION & SUBJECTIVITY (scored ${s.score}/5): Too neutral and objective. Add personal opinions, emotional reactions ("I love this", "frustrating", "impressive"), and subjective judgments. ${s.detail}`
        );
        break;
      case 11: // Cliche & AI-Typical Phrases
        instructions.push(
          `AI CLICHES (scored ${s.score}/5): Contains AI-typical phrases that must be eliminated. REMOVE or REPHRASE: "delve", "landscape", "it's worth noting", "in today's", "comprehensive", "cutting-edge", "game-changer", "navigate", "realm", "foster", "leverage", "a testament to", "pivotal".${s.examples.length > 0 ? ' Specifically found: ' + s.examples.slice(0, 5).join('; ') : ''}`
        );
        break;
      case 12: // Vocabulary Sophistication
        instructions.push(
          `VOCABULARY LEVEL (scored ${s.score}/5): ${s.score >= 4 ? 'Vocabulary is too consistently sophisticated. Use more everyday words.' : 'Vocabulary is too simple. Mix in some more specific or technical terms where appropriate.'} ${s.detail}`
        );
        break;
      case 13: // Named Entities
        instructions.push(
          `SPECIFICITY (scored ${s.score}/5): Not enough specific details. Add real names, specific numbers, dates, brands, locations, or technical specifications. ${s.detail}`
        );
        break;
      case 14: // Adverb & Intensifier Usage
        instructions.push(
          `ADVERB OVERUSE (scored ${s.score}/5): Too many adverbs and intensifiers. Remove or replace: "significantly", "effectively", "essentially", "fundamentally", "incredibly", "extremely", "remarkably", "ultimately".${s.examples.length > 0 ? ' Found: ' + s.examples.slice(0, 5).join(', ') : ''}`
        );
        break;
      case 15: // Passive Voice
        instructions.push(
          `PASSIVE VOICE (scored ${s.score}/5): ${s.score >= 4 ? 'Too much passive voice — convert most to active voice.' : 'Not enough passive voice variety — add a few passive constructions for natural mix.'} ${s.detail}`
        );
        break;
      case 16: // Discourse Markers
        instructions.push(
          `DISCOURSE MARKERS (scored ${s.score}/5): ${s.detail}. Adjust the frequency of words like "well", "you know", "actually", "basically", "honestly" to sound more natural.`
        );
        break;
      case 17: // Figurative Language
        instructions.push(
          `FIGURATIVE LANGUAGE (scored ${s.score}/5): Not enough metaphors, similes, idioms, or colorful expressions. Add natural figurative language — "it's like...", "feels like pulling teeth", "a breath of fresh air". ${s.detail}`
        );
        break;
      case 18: // Readability Consistency
        instructions.push(
          `READABILITY CONSISTENCY (scored ${s.score}/5): The reading level is too uniform throughout. Vary complexity — some sections should be simple and punchy, others more detailed and complex. ${s.detail}`
        );
        break;
      case 19: // Hedging Language
        instructions.push(
          `HEDGING (scored ${s.score}/5): ${s.score >= 4 ? 'Too much hedging ("might", "could", "perhaps"). Be more assertive with direct statements.' : 'Not enough hedging — add some uncertainty markers ("I think", "probably", "seems like") for natural human doubt.'} ${s.detail}`
        );
        break;
      case 20: // Perplexity
        instructions.push(
          `PREDICTABILITY (scored ${s.score}/5): The text is too predictable in word choices. Use more unexpected words, surprising comparisons, and less obvious phrasing. Humans are less predictable than AI. ${s.detail}`
        );
        break;
      case 21: // Colon Lead-in
        instructions.push(
          `COLON LEAD-INS (scored ${s.score}/5): Too many "X: Y" patterns typical of AI. Restructure sentences that use colons as lead-ins into flowing prose.${s.examples.length > 0 ? ' Found: ' + s.examples.slice(0, 3).join('; ') : ''}`
        );
        break;
      default:
        instructions.push(`Signal ${s.signalId} (${s.name}, scored ${s.score}/5): ${s.detail}`);
    }
  }

  return instructions.join('\n\n');
}

export async function POST(req: NextRequest) {
  try {
    const { text, signals, compositeScore, contentType, targetKeyword } = await req.json();

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!text || text.trim().length < 50) {
      return new Response(
        JSON.stringify({ error: 'Text too short to rewrite' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const anthropic = new Anthropic({ apiKey });
    const signalInstructions = buildSignalInstructions(signals || []);

    const systemPrompt = `You are an expert content editor specializing in making AI-generated text sound naturally human-written. Your job is to rewrite the provided article to reduce AI detection signals while preserving the original meaning, structure, and key information.

The article currently scores ${compositeScore?.toFixed(2) || 'unknown'}/5 on AI detection (1=Human, 5=AI). Your goal is to bring it below 2.0.

## SPECIFIC ISSUES TO FIX:

${signalInstructions}

## REWRITING RULES:

1. PRESERVE the article's topic, key facts, structure (headings, sections), and overall length
2. PRESERVE any specific data, quotes, product names, and technical details
3. Keep the same heading structure (H1, H2, H3) — reword headings if needed but keep the hierarchy
4. DO NOT add meta-commentary like "Here's the rewritten version" — just output the rewritten article
5. Output as clean Markdown with proper heading levels (# for H1, ## for H2, etc.)
6. Keep approximately the same word count (within 15%)
${targetKeyword ? `7. Maintain natural usage of the target keyword: "${targetKeyword}"` : ''}
${contentType ? `8. This is a ${contentType.replace('_', ' ')} — maintain appropriate style for this format` : ''}

## CRITICAL:
- Make the text sound like a real person wrote it from experience
- Add personality, opinions, and natural imperfections
- Vary rhythm dramatically — short sentences. Then longer, more complex ones that wind through an idea.
- Use contractions (don't, can't, won't, it's)
- Start some sentences with "And", "But", "So" — the way people actually write
- Break the occasional grammar rule on purpose for emphasis
- Insert brief asides or tangential thoughts in parentheses occasionally`;

    const stream = anthropic.messages.stream({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: `Rewrite this article to sound more human-written while fixing the AI detection signals identified above:\n\n${text}`,
        },
      ],
    });

    const readableStream = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of stream) {
            if (
              event.type === 'content_block_delta' &&
              event.delta.type === 'text_delta'
            ) {
              controller.enqueue(new TextEncoder().encode(event.delta.text));
            }
          }
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });

    return new Response(readableStream, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  } catch (error) {
    console.error('AI rewrite error:', error);
    return new Response(
      JSON.stringify({ error: 'Rewrite failed' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
