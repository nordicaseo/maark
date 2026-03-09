import { resolveProviderForAction } from '@/lib/ai/model-resolution';
import {
  AGENT_KNOWLEDGE_PART_TYPES,
  type AgentKnowledgePart,
  type AgentRole,
} from '@/types/agent-profile';
import type { AgentLaneKey } from '@/types/agent-runtime';

function stripCodeFences(input: string): string {
  return input
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const cleaned = stripCodeFences(raw);
  try {
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
    }
    throw new Error('Generation output was not valid JSON.');
  }
}

function normalizeKnowledgeParts(input: unknown): AgentKnowledgePart[] {
  if (!Array.isArray(input)) return [];
  const out: AgentKnowledgePart[] = [];
  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const rawPartType = String(row.partType || '').trim();
    const partType = AGENT_KNOWLEDGE_PART_TYPES.includes(
      rawPartType as (typeof AGENT_KNOWLEDGE_PART_TYPES)[number]
    )
      ? (rawPartType as (typeof AGENT_KNOWLEDGE_PART_TYPES)[number])
      : 'custom';
    const content = String(row.content || '').trim();
    if (!content) continue;
    const label = String(row.label || '').trim() || partType.replace(/_/g, ' ');
    const sortOrder = Number.isFinite(Number(row.sortOrder))
      ? Math.max(0, Math.trunc(Number(row.sortOrder)))
      : out.length;
    out.push({
      id: `${partType}:${sortOrder}`,
      partType,
      label,
      content,
      sortOrder,
    });
  }
  return out;
}

async function collectStreamText(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out.trim();
}

export interface AgentKnowledgeGenerationInput {
  projectName?: string;
  role: AgentRole;
  laneKey?: AgentLaneKey;
  description?: string;
  sourceUrls?: string[];
  sourceDocuments?: Array<{ name: string; content: string }>;
}

export interface AgentKnowledgeGenerationResult {
  displayName: string;
  shortDescription: string;
  mission: string;
  fileBundle: Partial<Record<'SOUL' | 'IDENTITY' | 'AGENTS' | 'TOOLS', string>>;
  knowledgeParts: AgentKnowledgePart[];
  raw: string;
}

export async function generateAgentKnowledgeProfile(
  input: AgentKnowledgeGenerationInput
): Promise<AgentKnowledgeGenerationResult> {
  const { provider, model, maxTokens, temperature } = await resolveProviderForAction(
    'skill_generation'
  );
  const roleHint =
    input.role === 'writer' && input.laneKey
      ? `${input.role} (${input.laneKey} lane)`
      : input.role;

  const sourceSections: string[] = [];
  if (input.description?.trim()) {
    sourceSections.push(`Description:\n${input.description.trim()}`);
  }
  if (input.sourceUrls && input.sourceUrls.length > 0) {
    sourceSections.push(`Source URLs:\n${input.sourceUrls.map((url) => `- ${url}`).join('\n')}`);
  }
  if (input.sourceDocuments && input.sourceDocuments.length > 0) {
    sourceSections.push(
      `Source documents:\n${input.sourceDocuments
        .map((doc) => `## ${doc.name}\n${doc.content.trim().slice(0, 5000)}`)
        .join('\n\n')}`
    );
  }

  const system = `You generate project-scoped AI agent identity and knowledge.
Return strict JSON only:
{
  "displayName": string,
  "shortDescription": string,
  "mission": string,
  "fileBundle": {
    "SOUL": string,
    "IDENTITY": string,
    "AGENTS": string,
    "TOOLS": string
  },
  "knowledgeParts": [
    {
      "partType": "brand_identity|brand_voice|technical|content_structure|seo|compliance|custom",
      "label": string,
      "content": string,
      "sortOrder": number
    }
  ]
}
Rules:
- Use concrete instructions that a production content agent can execute.
- Include every major partType at least once when source material supports it.
- Keep mission specific to the role and workflow outcomes.
- Do not include markdown code fences.`;

  const userPrompt = `Project: ${input.projectName || 'Current project'}
Role: ${roleHint}

${sourceSections.join('\n\n') || 'No additional source material provided.'}

Generate full identity + knowledge now.`;

  const raw = await collectStreamText(
    provider.stream({
      model,
      system,
      messages: [{ role: 'user', content: userPrompt }],
      maxTokens: Math.max(maxTokens, 4096),
      temperature,
    })
  );

  const parsed = parseJsonObject(raw);
  const fileBundleRaw =
    parsed.fileBundle && typeof parsed.fileBundle === 'object'
      ? (parsed.fileBundle as Record<string, unknown>)
      : {};

  return {
    displayName: String(parsed.displayName || '').trim() || `Agent ${roleHint}`,
    shortDescription:
      String(parsed.shortDescription || '').trim() || `Project ${roleHint} agent`,
    mission: String(parsed.mission || '').trim() || `Deliver reliable ${roleHint} outcomes.`,
    fileBundle: {
      SOUL: String(fileBundleRaw.SOUL || '').trim(),
      IDENTITY: String(fileBundleRaw.IDENTITY || '').trim(),
      AGENTS: String(fileBundleRaw.AGENTS || '').trim(),
      TOOLS: String(fileBundleRaw.TOOLS || '').trim(),
    },
    knowledgeParts: normalizeKnowledgeParts(parsed.knowledgeParts),
    raw,
  };
}
