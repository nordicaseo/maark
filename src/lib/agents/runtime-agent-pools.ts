import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { getConvexClient } from '@/lib/convex/server';
import { FIXED_AGENT_ROLES, type AgentRole } from '@/types/agent-profile';
import type {
  AgentRoleCounts,
  AgentStaffingTemplate,
  ProjectAgentPoolHealth,
  ProjectAgentRuntimeSettings,
} from '@/types/agent-runtime';

type ConvexAgent = {
  _id: Id<'agents'>;
  name: string;
  role: string;
  status: string;
  projectId?: number;
  isDedicated?: boolean;
  capacityWeight?: number;
  slotKey?: string;
  assignmentHealth?: Record<string, unknown>;
  currentTaskId?: Id<'tasks'>;
};

type ConvexTask = {
  _id: Id<'tasks'>;
  status: string;
  workflowCurrentStageKey?: string;
  workflowStageStatus?: string;
};

const ROLE_SEED_DEFAULTS: Record<
  AgentRole,
  { name: string; specialization: string; skills: string[] }
> = {
  researcher: {
    name: 'Sage',
    specialization: 'Research & data analysis',
    skills: ['topic research', 'competitor analysis', 'data synthesis', 'citations'],
  },
  outliner: {
    name: 'Maple',
    specialization: 'Structured outlines and narrative flow',
    skills: ['outline design', 'content architecture', 'section planning'],
  },
  writer: {
    name: 'Atlas',
    specialization: 'Long-form SEO content',
    skills: ['SEO writing', 'keyword research', 'content structure', 'blog posts'],
  },
  'seo-reviewer': {
    name: 'Orion',
    specialization: 'SEO and on-page optimization reviews',
    skills: ['SERP alignment', 'on-page SEO', 'metadata reviews', 'internal linking'],
  },
  'project-manager': {
    name: 'Pulse',
    specialization: 'Workflow orchestration and handoffs',
    skills: ['workflow planning', 'handoffs', 'risk checks'],
  },
  seo: {
    name: 'Helix',
    specialization: 'SEO strategy and keyword alignment',
    skills: ['keyword strategy', 'entity coverage', 'ranking factors'],
  },
  content: {
    name: 'Lumen',
    specialization: 'General content production support',
    skills: ['content planning', 'drafting', 'editing support'],
  },
  lead: {
    name: 'Astra',
    specialization: 'Editorial lead and escalation fallback',
    skills: ['quality oversight', 'final decisions', 'workflow escalation'],
  },
};

const TEMPLATE_COUNTS: Record<AgentStaffingTemplate, Record<AgentRole, number>> = {
  small: {
    researcher: 1,
    outliner: 1,
    writer: 1,
    'seo-reviewer': 1,
    'project-manager': 1,
    seo: 1,
    content: 1,
    lead: 1,
  },
  standard: {
    researcher: 1,
    outliner: 2,
    writer: 2,
    'seo-reviewer': 2,
    'project-manager': 1,
    seo: 1,
    content: 2,
    lead: 1,
  },
  premium: {
    researcher: 2,
    outliner: 2,
    writer: 3,
    'seo-reviewer': 2,
    'project-manager': 2,
    seo: 2,
    content: 2,
    lead: 1,
  },
};

function normalizeStatus(status: string | null | undefined): 'ONLINE' | 'IDLE' | 'WORKING' | 'OFFLINE' {
  const normalized = String(status || '')
    .trim()
    .toUpperCase();
  if (normalized === 'ONLINE') return 'ONLINE';
  if (normalized === 'IDLE') return 'IDLE';
  if (normalized === 'WORKING') return 'WORKING';
  return 'OFFLINE';
}

function normalizeTemplate(value: unknown): AgentStaffingTemplate {
  if (value === 'small' || value === 'standard' || value === 'premium') return value;
  return 'small';
}

function parseRoleCounts(input: unknown): AgentRoleCounts {
  if (!input || typeof input !== 'object') return {};
  const source = input as Record<string, unknown>;
  const out: AgentRoleCounts = {};
  for (const role of FIXED_AGENT_ROLES) {
    const raw = source[role];
    if (raw === undefined || raw === null) continue;
    const value = Math.max(1, Math.min(10, Number.parseInt(String(raw), 10) || 1));
    out[role] = value;
  }
  return out;
}

export function parseProjectRuntimeSettings(settings: unknown): ProjectAgentRuntimeSettings {
  const source =
    settings && typeof settings === 'object' ? (settings as Record<string, unknown>) : {};
  const runtime =
    source.agentRuntime && typeof source.agentRuntime === 'object'
      ? (source.agentRuntime as Record<string, unknown>)
      : {};
  return {
    staffingTemplate: normalizeTemplate(runtime.staffingTemplate),
    roleCounts: parseRoleCounts(runtime.roleCounts),
    strictIsolation:
      runtime.strictIsolation === undefined ? true : String(runtime.strictIsolation) !== 'false',
  };
}

export function buildRoleCounts(
  template: AgentStaffingTemplate,
  overrides?: AgentRoleCounts
): Record<AgentRole, number> {
  const base = TEMPLATE_COUNTS[template];
  const out = {} as Record<AgentRole, number>;
  for (const role of FIXED_AGENT_ROLES) {
    const override = overrides?.[role];
    out[role] = Math.max(1, Math.min(10, Number(override ?? base[role] ?? 1)));
  }
  return out;
}

function roleSlotKey(projectId: number, role: AgentRole, ordinal: number): string {
  return `p${projectId}:${role}:${ordinal}`;
}

function buildAgentName(role: AgentRole, ordinal: number): string {
  const base = ROLE_SEED_DEFAULTS[role].name;
  return ordinal <= 1 ? base : `${base} ${ordinal}`;
}

export async function syncProjectDedicatedAgentPool(args: {
  projectId: number;
  template: AgentStaffingTemplate;
  roleCounts?: AgentRoleCounts;
}): Promise<{
  created: number;
  updated: number;
  totalDedicated: number;
  targetByRole: Record<AgentRole, number>;
}> {
  const convex = getConvexClient();
  if (!convex) {
    throw new Error('Mission Control is not configured (Convex URL missing)');
  }

  const targetByRole = buildRoleCounts(args.template, args.roleCounts);
  const allAgents = (await convex.query(api.agents.list, { limit: 2000 })) as ConvexAgent[];
  const projectAgents = allAgents.filter((agent) => Number(agent.projectId) === args.projectId);
  const bySlot = new Map<string, ConvexAgent>();
  for (const agent of projectAgents) {
    if (agent.slotKey) bySlot.set(agent.slotKey, agent);
  }

  let created = 0;
  let updated = 0;

  for (const role of FIXED_AGENT_ROLES) {
    const count = targetByRole[role];
    for (let idx = 1; idx <= count; idx += 1) {
      const slotKey = roleSlotKey(args.projectId, role, idx);
      const existing = bySlot.get(slotKey);
      if (!existing) {
        const seed = ROLE_SEED_DEFAULTS[role];
        await convex.mutation(api.agents.register, {
          name: buildAgentName(role, idx),
          role,
          specialization: seed.specialization,
          skills: seed.skills,
          projectId: args.projectId,
          isDedicated: true,
          capacityWeight: 1,
          slotKey,
          assignmentHealth: {
            routable: true,
            strictIsolation: true,
          },
        });
        created += 1;
        continue;
      }

      const assignmentHealth = {
        ...(existing.assignmentHealth || {}),
        routable: true,
        strictIsolation: true,
      };
      const existingHealth = (existing.assignmentHealth || {}) as Record<string, unknown>;
      const hasHealthDiff =
        existingHealth.routable !== true || existingHealth.strictIsolation !== true;
      const needsUpdate =
        existing.projectId !== args.projectId ||
        existing.isDedicated !== true ||
        Number(existing.capacityWeight || 1) !== 1;
      if (needsUpdate || hasHealthDiff) {
        await convex.mutation(api.agents.updateRuntime, {
          id: existing._id,
          projectId: args.projectId,
          isDedicated: true,
          capacityWeight: 1,
          slotKey,
          assignmentHealth,
        });
        updated += 1;
      }
    }
  }

  return {
    created,
    updated,
    totalDedicated: projectAgents.filter((agent) => agent.isDedicated !== false).length + created,
    targetByRole,
  };
}

export async function markLegacyGlobalAgentsNonRoutable(): Promise<{
  updated: number;
}> {
  const convex = getConvexClient();
  if (!convex) {
    throw new Error('Mission Control is not configured (Convex URL missing)');
  }

  const allAgents = (await convex.query(api.agents.list, { limit: 2000 })) as ConvexAgent[];
  let updated = 0;
  for (const agent of allAgents) {
    if (agent.projectId !== undefined && agent.projectId !== null) continue;
    const existingHealth = (agent.assignmentHealth || {}) as Record<string, unknown>;
    if (existingHealth.routable === false && agent.isDedicated === false) continue;
    await convex.mutation(api.agents.updateRuntime, {
      id: agent._id,
      isDedicated: false,
      assignmentHealth: {
        ...existingHealth,
        routable: false,
        legacyGlobal: true,
      },
    });
    updated += 1;
  }
  return { updated };
}

export async function getProjectAgentPoolHealth(projectId: number): Promise<ProjectAgentPoolHealth> {
  const convex = getConvexClient();
  if (!convex) {
    throw new Error('Mission Control is not configured (Convex URL missing)');
  }

  const allAgents = (await convex.query(api.agents.list, { projectId, limit: 800 })) as ConvexAgent[];
  const tasks = (await convex.query(api.tasks.list, { projectId, limit: 1200 })) as ConvexTask[];
  const taskMap = new Map<string, ConvexTask>(tasks.map((task) => [String(task._id), task]));
  const writers = allAgents.filter((agent) => agent.role.toLowerCase() === 'writer');

  let staleLocks = 0;
  const writerRows = writers.map((writer) => {
    const status = normalizeStatus(writer.status);
    const taskId = writer.currentTaskId ? String(writer.currentTaskId) : null;
    const linkedTask = taskId ? taskMap.get(taskId) : null;
    let lockHealth: 'healthy' | 'stale' | 'unknown_task' | 'idle' | 'offline' = 'healthy';
    if (status === 'OFFLINE') {
      lockHealth = 'offline';
    } else if (status !== 'WORKING') {
      lockHealth = 'idle';
    } else if (!taskId) {
      lockHealth = 'stale';
      staleLocks += 1;
    } else if (!linkedTask) {
      lockHealth = 'unknown_task';
      staleLocks += 1;
    } else {
      const valid =
        linkedTask.workflowCurrentStageKey === 'writing' &&
        linkedTask.workflowStageStatus === 'in_progress' &&
        linkedTask.status === 'IN_PROGRESS';
      if (!valid) {
        lockHealth = 'stale';
        staleLocks += 1;
      }
    }
    return {
      id: String(writer._id),
      name: writer.name,
      status,
      lockHealth,
      currentTaskId: taskId,
    };
  });

  const byRole = FIXED_AGENT_ROLES.map((role) => {
    const roleAgents = allAgents.filter((agent) => agent.role.toLowerCase() === role);
    return {
      role,
      total: roleAgents.length,
      online: roleAgents.filter((agent) => normalizeStatus(agent.status) === 'ONLINE').length,
      idle: roleAgents.filter((agent) => normalizeStatus(agent.status) === 'IDLE').length,
      working: roleAgents.filter((agent) => normalizeStatus(agent.status) === 'WORKING').length,
      offline: roleAgents.filter((agent) => normalizeStatus(agent.status) === 'OFFLINE').length,
    };
  });

  const queuedWriting = tasks.filter(
    (task) => task.workflowCurrentStageKey === 'writing' && task.workflowStageStatus === 'queued'
  ).length;

  return {
    projectId,
    totalAgents: allAgents.length,
    totalDedicated: allAgents.filter((agent) => agent.isDedicated !== false).length,
    availableWriters: writers.filter((writer) => {
      const status = normalizeStatus(writer.status);
      return status === 'ONLINE' || status === 'IDLE';
    }).length,
    queuedWriting,
    staleLocks,
    byRole,
    writerRows,
  };
}
