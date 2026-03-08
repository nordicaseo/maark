import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { getConvexClient } from '@/lib/convex/server';
import { FIXED_AGENT_ROLES, type AgentRole } from '@/types/agent-profile';
import type {
  AgentLaneKey,
  AgentRoleCounts,
  AgentStaffingTemplate,
  ProjectLaneCapacitySettings,
  ProjectAgentPoolHealth,
  ProjectAgentRuntimeSettings,
} from '@/types/agent-runtime';
import {
  AGENT_WRITER_LANES,
  DEFAULT_LANE_CAPACITY_SETTINGS,
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
  laneKey?: string;
  laneProfileKey?: string;
  assignmentHealth?: Record<string, unknown>;
  currentTaskId?: Id<'tasks'>;
  updatedAt?: number;
};

type ConvexTask = {
  _id: Id<'tasks'>;
  status: string;
  workflowCurrentStageKey?: string;
  workflowStageStatus?: string;
  workflowLaneKey?: string;
  workflowLastEventAt?: number | null;
  updatedAt?: number | null;
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
  editor: {
    name: 'Quill',
    specialization: 'Editorial QA and refinement',
    skills: ['line editing', 'readability', 'fact consistency', 'style compliance'],
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

const WRITER_LANE_NAMES: Record<AgentLaneKey, string> = {
  blog: 'Atlas Blog',
  collection: 'Atlas Collection',
  product: 'Atlas Product',
  landing: 'Atlas Landing',
};

const DEFAULT_PROJECT_AGENT_POOL_MODE = 'strict';

const TEMPLATE_COUNTS: Record<AgentStaffingTemplate, Record<AgentRole, number>> = {
  small: {
    researcher: 1,
    outliner: 1,
    writer: 1,
    editor: 1,
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
    editor: 2,
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
    editor: 2,
    'seo-reviewer': 2,
    'project-manager': 2,
    seo: 2,
    content: 2,
    lead: 1,
  },
};

export function strictProjectAgentPoolsEnabled(): boolean {
  const mode = String(process.env.PROJECT_AGENT_POOL_MODE ?? DEFAULT_PROJECT_AGENT_POOL_MODE)
    .trim()
    .toLowerCase();
  return !['legacy', 'shared', 'global', '0', 'false', 'off'].includes(mode);
}

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

function isAgentLaneKey(value: unknown): value is AgentLaneKey {
  return AGENT_WRITER_LANES.includes(value as AgentLaneKey);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
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

function parseLaneCapacity(input: unknown): ProjectLaneCapacitySettings {
  const source = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const min = clamp(
    Number.parseInt(String(source.minWritersPerLane ?? DEFAULT_LANE_CAPACITY_SETTINGS.minWritersPerLane), 10) ||
      DEFAULT_LANE_CAPACITY_SETTINGS.minWritersPerLane,
    1,
    5
  );
  const maxRaw =
    Number.parseInt(String(source.maxWritersPerLane ?? DEFAULT_LANE_CAPACITY_SETTINGS.maxWritersPerLane), 10) ||
    DEFAULT_LANE_CAPACITY_SETTINGS.maxWritersPerLane;
  const max = clamp(Math.max(min, maxRaw), min, 8);
  const scaleUpQueueAgeSec = clamp(
    Number.parseInt(String(source.scaleUpQueueAgeSec ?? DEFAULT_LANE_CAPACITY_SETTINGS.scaleUpQueueAgeSec), 10) ||
      DEFAULT_LANE_CAPACITY_SETTINGS.scaleUpQueueAgeSec,
    30,
    3600
  );
  const scaleDownIdleSec = clamp(
    Number.parseInt(String(source.scaleDownIdleSec ?? DEFAULT_LANE_CAPACITY_SETTINGS.scaleDownIdleSec), 10) ||
      DEFAULT_LANE_CAPACITY_SETTINGS.scaleDownIdleSec,
    300,
    86_400
  );
  return {
    minWritersPerLane: min,
    maxWritersPerLane: max,
    scaleUpQueueAgeSec,
    scaleDownIdleSec,
  };
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
    laneCapacity: parseLaneCapacity(runtime.laneCapacity),
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

function writerLaneSlotKey(projectId: number, laneKey: AgentLaneKey, ordinal: number): string {
  return `p${projectId}:writer:${laneKey}:${ordinal}`;
}

function writerLaneAutoSlotKey(projectId: number, laneKey: AgentLaneKey, ordinal: number): string {
  return `p${projectId}:writer:${laneKey}:auto:${ordinal}`;
}

function buildAgentName(role: AgentRole, ordinal: number): string {
  const base = ROLE_SEED_DEFAULTS[role].name;
  return ordinal <= 1 ? base : `${base} ${ordinal}`;
}

export async function syncProjectDedicatedAgentPool(args: {
  projectId: number;
  template: AgentStaffingTemplate;
  roleCounts?: AgentRoleCounts;
  laneCapacity?: Partial<ProjectLaneCapacitySettings>;
}): Promise<{
  created: number;
  updated: number;
  totalDedicated: number;
  targetByRole: Record<AgentRole, number>;
  targetWriterByLane: Record<AgentLaneKey, number>;
}> {
  const convex = getConvexClient();
  if (!convex) {
    throw new Error('Mission Control is not configured (Convex URL missing)');
  }

  const targetByRole = buildRoleCounts(args.template, args.roleCounts);
  const laneCapacity = parseLaneCapacity(args.laneCapacity);
  const targetWriterByLane = Object.fromEntries(
    AGENT_WRITER_LANES.map((laneKey) => [laneKey, laneCapacity.minWritersPerLane])
  ) as Record<AgentLaneKey, number>;
  const allAgents = (await convex.query(api.agents.list, { limit: 2000 })) as ConvexAgent[];
  const projectAgents = allAgents.filter((agent) => Number(agent.projectId) === args.projectId);
  const bySlot = new Map<string, ConvexAgent>();
  for (const agent of projectAgents) {
    if (agent.slotKey) bySlot.set(agent.slotKey, agent);
  }

  let created = 0;
  let updated = 0;

  for (const role of FIXED_AGENT_ROLES) {
    if (role === 'writer') continue;
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
        existing.laneKey !== undefined ||
        existing.laneProfileKey !== undefined ||
        Number(existing.capacityWeight || 1) !== 1;
      if (needsUpdate || hasHealthDiff) {
        await convex.mutation(api.agents.updateRuntime, {
          id: existing._id,
          projectId: args.projectId,
          isDedicated: true,
          capacityWeight: 1,
          slotKey,
          laneKey: null,
          laneProfileKey: null,
          assignmentHealth,
        });
        updated += 1;
      }
    }
  }

  for (const laneKey of AGENT_WRITER_LANES) {
    const targetCount = targetWriterByLane[laneKey];
    for (let idx = 1; idx <= targetCount; idx += 1) {
      const slotKey = writerLaneSlotKey(args.projectId, laneKey, idx);
      const existing = bySlot.get(slotKey);
      if (!existing) {
        await convex.mutation(api.agents.register, {
          name: idx <= 1 ? WRITER_LANE_NAMES[laneKey] : `${WRITER_LANE_NAMES[laneKey]} ${idx}`,
          role: 'writer',
          specialization: `Lane writer (${laneKey})`,
          skills: ROLE_SEED_DEFAULTS.writer.skills,
          projectId: args.projectId,
          isDedicated: true,
          capacityWeight: 1,
          slotKey,
          laneKey,
          laneProfileKey: `writer:${laneKey}`,
          assignmentHealth: {
            routable: true,
            strictIsolation: true,
            temporary: false,
          },
        });
        created += 1;
        continue;
      }

      const existingHealth = (existing.assignmentHealth || {}) as Record<string, unknown>;
      const assignmentHealth = {
        ...existingHealth,
        routable: true,
        strictIsolation: true,
        temporary: existingHealth.temporary === true,
      };
      const needsUpdate =
        existing.projectId !== args.projectId ||
        existing.isDedicated !== true ||
        existing.laneKey !== laneKey ||
        existing.laneProfileKey !== `writer:${laneKey}` ||
        Number(existing.capacityWeight || 1) !== 1;
      const hasHealthDiff =
        existingHealth.routable !== true ||
        existingHealth.strictIsolation !== true;
      if (needsUpdate || hasHealthDiff) {
        await convex.mutation(api.agents.updateRuntime, {
          id: existing._id,
          projectId: args.projectId,
          isDedicated: true,
          capacityWeight: 1,
          slotKey,
          laneKey,
          laneProfileKey: `writer:${laneKey}`,
          assignmentHealth,
        });
        updated += 1;
      }
    }
  }

  const staleGenericWriters = projectAgents.filter(
    (agent) =>
      agent.role.toLowerCase() === 'writer' &&
      !agent.laneKey &&
      ((agent.assignmentHealth || {}) as Record<string, unknown>).routable !== false
  );
  for (const writer of staleGenericWriters) {
    await convex.mutation(api.agents.updateRuntime, {
      id: writer._id,
      assignmentHealth: {
        ...((writer.assignmentHealth || {}) as Record<string, unknown>),
        routable: false,
        writerLaneRequired: true,
      },
    });
    updated += 1;
  }

  return {
    created,
    updated,
    totalDedicated: projectAgents.filter((agent) => agent.isDedicated !== false).length + created,
    targetByRole,
    targetWriterByLane,
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
  const now = Date.now();

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
      laneKey: isAgentLaneKey(writer.laneKey) ? writer.laneKey : null,
      isTemporary: ((writer.assignmentHealth || {}) as Record<string, unknown>).temporary === true,
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
  const laneHealth = AGENT_WRITER_LANES.map((laneKey) => {
    const laneWriters = writers.filter((writer) => writer.laneKey === laneKey);
    const availableWriters = laneWriters.filter((writer) => {
      const status = normalizeStatus(writer.status);
      return status === 'ONLINE' || status === 'IDLE';
    }).length;
    const workingWriters = laneWriters.filter(
      (writer) => normalizeStatus(writer.status) === 'WORKING'
    ).length;
    const laneQueued = tasks.filter(
      (task) =>
        task.workflowCurrentStageKey === 'writing' &&
        task.workflowStageStatus === 'queued' &&
        task.workflowLaneKey === laneKey
    );
    const oldestQueueAgeSec =
      laneQueued.length > 0
        ? Math.max(
            ...laneQueued.map((task) => {
              const ts = task.workflowLastEventAt || task.updatedAt || now;
              return Math.max(0, Math.floor((now - ts) / 1000));
            })
          )
        : 0;
    return {
      laneKey,
      totalWriters: laneWriters.length,
      availableWriters,
      workingWriters,
      queuedWriting: laneQueued.length,
      oldestQueueAgeSec,
    };
  });

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
    laneHealth,
  };
}

export async function autoScaleProjectWriterLanes(args: {
  projectId: number;
  laneCapacity: ProjectLaneCapacitySettings;
}): Promise<{
  scaledUp: number;
  scaledDown: number;
}> {
  const convex = getConvexClient();
  if (!convex) {
    throw new Error('Mission Control is not configured (Convex URL missing)');
  }

  const allAgents = (await convex.query(api.agents.list, {
    projectId: args.projectId,
    role: 'writer',
    limit: 1200,
  })) as ConvexAgent[];
  const tasks = (await convex.query(api.tasks.list, {
    projectId: args.projectId,
    limit: 1200,
  })) as ConvexTask[];
  const now = Date.now();
  let scaledUp = 0;
  let scaledDown = 0;

  for (const laneKey of AGENT_WRITER_LANES) {
    const laneWriters = allAgents.filter(
      (writer) => writer.role.toLowerCase() === 'writer' && writer.laneKey === laneKey
    );
    const laneQueued = tasks.filter(
      (task) =>
        task.workflowCurrentStageKey === 'writing' &&
        task.workflowStageStatus === 'queued' &&
        task.workflowLaneKey === laneKey
    );
    const oldestQueuedTs =
      laneQueued.length > 0
        ? Math.min(
            ...laneQueued.map((task) => task.workflowLastEventAt || task.updatedAt || now)
          )
        : null;
    const queueAgeSec =
      oldestQueuedTs !== null ? Math.max(0, Math.floor((now - oldestQueuedTs) / 1000)) : 0;
    const routableCount = laneWriters.filter(
      (writer) => ((writer.assignmentHealth || {}) as Record<string, unknown>).routable !== false
    ).length;

    if (
      laneQueued.length > 0 &&
      queueAgeSec >= args.laneCapacity.scaleUpQueueAgeSec &&
      routableCount < args.laneCapacity.maxWritersPerLane
    ) {
      const existingAutoOrdinals = laneWriters
        .map((writer) => String(writer.slotKey || ''))
        .filter((slotKey) => slotKey.includes(`:writer:${laneKey}:auto:`))
        .map((slotKey) => Number.parseInt(slotKey.split(':').pop() || '', 10))
        .filter((n) => Number.isFinite(n));
      const nextOrdinal = existingAutoOrdinals.length > 0 ? Math.max(...existingAutoOrdinals) + 1 : 1;
      await convex.mutation(api.agents.register, {
        name: `${WRITER_LANE_NAMES[laneKey]} Auto ${nextOrdinal}`,
        role: 'writer',
        specialization: `Auto-scaled lane writer (${laneKey})`,
        skills: ROLE_SEED_DEFAULTS.writer.skills,
        projectId: args.projectId,
        isDedicated: true,
        capacityWeight: 1,
        laneKey,
        laneProfileKey: `writer:${laneKey}`,
        slotKey: writerLaneAutoSlotKey(args.projectId, laneKey, nextOrdinal),
        assignmentHealth: {
          routable: true,
          strictIsolation: true,
          temporary: true,
        },
      });
      scaledUp += 1;
      continue;
    }

    if (laneQueued.length > 0) continue;
    if (routableCount <= args.laneCapacity.minWritersPerLane) continue;

    let laneScaledDown = 0;
    const removable = laneWriters
      .filter((writer) => ((writer.assignmentHealth || {}) as Record<string, unknown>).temporary === true)
      .filter((writer) => {
        const status = normalizeStatus(writer.status);
        return status === 'ONLINE' || status === 'IDLE' || status === 'OFFLINE';
      })
      .filter((writer) => !writer.currentTaskId)
      .sort((a, b) => Number(a.updatedAt || 0) - Number(b.updatedAt || 0));
    for (const writer of removable) {
      if (routableCount - laneScaledDown <= args.laneCapacity.minWritersPerLane) break;
      const idleForSec = Math.max(0, Math.floor((now - Number(writer.updatedAt || now)) / 1000));
      if (idleForSec < args.laneCapacity.scaleDownIdleSec) continue;
      await convex.mutation(api.agents.remove, { id: writer._id });
      laneScaledDown += 1;
      scaledDown += 1;
      break;
    }
  }

  return { scaledUp, scaledDown };
}
