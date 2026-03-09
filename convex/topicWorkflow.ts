import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import {
  WORKFLOW_ROLE_ALIASES,
  WORKFLOW_STAGE_OWNER_CHAINS,
  WORKFLOW_STAGE_TRANSITIONS,
} from "../workflow-contract";

const WORKFLOW_TEMPLATE_KEY = "topic_production_v1";
const INITIAL_WORKFLOW_START_DELAY_MS = 20_000;
const MIN_WORKFLOW_START_DELAY_MS = 0;
const MAX_WORKFLOW_START_DELAY_MS = 10 * 60 * 1000;
const DEFAULT_WRITER_LOCK_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_PROJECT_AGENT_POOL_MODE = "strict";

type TopicStageKey =
  | "research"
  | "seo_intel_review"
  | "outline_build"
  | "outline_review"
  | "prewrite_context"
  | "writing"
  | "editing"
  | "final_review"
  | "human_review"
  | "complete";

type AgentLaneKey = "blog" | "collection" | "product" | "landing";
type RoutableStageKey =
  | "research"
  | "seo_intel_review"
  | "outline_build"
  | "writing"
  | "editing"
  | "final_review";

const ROUTABLE_CONFIGURED_STAGES: ReadonlySet<RoutableStageKey> = new Set([
  "research",
  "seo_intel_review",
  "outline_build",
  "writing",
  "editing",
  "final_review",
]);

const TOPIC_STAGE_KEYS: TopicStageKey[] = [
  "research",
  "seo_intel_review",
  "outline_build",
  "outline_review",
  "prewrite_context",
  "writing",
  "editing",
  "final_review",
  "human_review",
  "complete",
];

function isTopicStageKey(value: unknown): value is TopicStageKey {
  return typeof value === "string" && TOPIC_STAGE_KEYS.includes(value as TopicStageKey);
}

const stageValidator = v.union(
  v.literal("research"),
  v.literal("seo_intel_review"),
  v.literal("outline_build"),
  v.literal("outline_review"),
  v.literal("prewrite_context"),
  v.literal("writing"),
  v.literal("editing"),
  v.literal("final_review"),
  v.literal("human_review"),
  v.literal("complete")
);

const laneValidator = v.union(
  v.literal("blog"),
  v.literal("collection"),
  v.literal("product"),
  v.literal("landing")
);

const artifactValidator = v.object({
  title: v.string(),
  body: v.optional(v.string()),
  data: v.optional(v.any()),
});

const deliverableValidator = v.object({
  id: v.optional(v.string()),
  type: v.string(),
  title: v.string(),
  url: v.optional(v.string()),
});

const stageTransitions: Record<TopicStageKey, TopicStageKey[]> = Object.fromEntries(
  Object.entries(WORKFLOW_STAGE_TRANSITIONS).map(([stage, nextStages]) => [
    stage,
    [...nextStages],
  ])
) as Record<TopicStageKey, TopicStageKey[]>;

function parsePlannedStageSequence(task: Doc<"tasks">): TopicStageKey[] {
  const plan =
    task.workflowStagePlan && typeof task.workflowStagePlan === "object"
      ? (task.workflowStagePlan as Record<string, unknown>)
      : null;
  const profile =
    plan?.workflowProfile && typeof plan.workflowProfile === "object"
      ? (plan.workflowProfile as Record<string, unknown>)
      : null;
  const sequenceRaw = Array.isArray(profile?.stageSequence)
    ? profile.stageSequence
    : [];
  const enabledRaw =
    profile?.stageEnabled && typeof profile.stageEnabled === "object"
      ? (profile.stageEnabled as Record<string, unknown>)
      : {};

  const sequence: TopicStageKey[] = [];
  for (const item of sequenceRaw) {
    if (!isTopicStageKey(item)) continue;
    if (item === "outline_review" || item === "prewrite_context") continue;
    if (sequence.includes(item)) continue;
    const enabledValue = enabledRaw[item];
    const enabled =
      enabledValue === undefined
        ? true
        : enabledValue === true || String(enabledValue).toLowerCase() === "true";
    if (!enabled) continue;
    sequence.push(item);
  }
  return sequence;
}

function resolvePlannedNextStage(
  task: Doc<"tasks">,
  currentStage: TopicStageKey
): TopicStageKey | null {
  const plannedSequence = parsePlannedStageSequence(task);
  if (plannedSequence.length === 0) return null;
  const index = plannedSequence.indexOf(currentStage);
  if (index < 0) return null;
  if (index >= plannedSequence.length - 1) return "complete";
  return plannedSequence[index + 1] || "complete";
}

function isAllowedTransitionByPlan(
  task: Doc<"tasks">,
  currentStage: TopicStageKey,
  toStage: TopicStageKey
): boolean {
  const plannedNext = resolvePlannedNextStage(task, currentStage);
  if (!plannedNext) return false;
  return plannedNext === toStage;
}

const stageOwnerChains: Record<TopicStageKey, string[]> = Object.fromEntries(
  Object.entries(WORKFLOW_STAGE_OWNER_CHAINS).map(([stage, owners]) => [
    stage,
    [...owners],
  ])
) as Record<TopicStageKey, string[]>;

const roleAliases: Record<string, string[]> = Object.fromEntries(
  Object.entries(WORKFLOW_ROLE_ALIASES).map(([role, aliases]) => [role, [...aliases]])
) as Record<string, string[]>;

const WORKFLOW_ROLE_SEEDS: Array<{
  name: string;
  role: string;
  specialization: string;
  skills: string[];
}> = [
  {
    name: "Atlas",
    role: "writer",
    specialization: "Long-form SEO content",
    skills: ["SEO writing", "keyword research", "content structure", "blog posts"],
  },
  {
    name: "Quill",
    role: "editor",
    specialization: "Editorial QA and refinement",
    skills: ["line editing", "readability", "fact consistency", "style compliance"],
  },
  {
    name: "Sage",
    role: "researcher",
    specialization: "Research & data analysis",
    skills: ["topic research", "competitor analysis", "data synthesis", "citations"],
  },
  {
    name: "Maple",
    role: "outliner",
    specialization: "Structured outlines and narrative flow",
    skills: ["outline design", "content architecture", "section planning"],
  },
  {
    name: "Orion",
    role: "seo-reviewer",
    specialization: "SEO and on-page optimization reviews",
    skills: ["SERP alignment", "on-page SEO", "metadata reviews", "internal linking"],
  },
  {
    name: "Pulse",
    role: "project-manager",
    specialization: "Workflow orchestration and handoffs",
    skills: ["workflow planning", "handoffs", "risk checks"],
  },
  {
    name: "Helix",
    role: "seo",
    specialization: "SEO strategy and keyword alignment",
    skills: ["keyword strategy", "entity coverage", "ranking factors"],
  },
  {
    name: "Lumen",
    role: "content",
    specialization: "General content production support",
    skills: ["content planning", "drafting", "editing support"],
  },
  {
    name: "Astra",
    role: "lead",
    specialization: "Editorial lead and escalation fallback",
    skills: ["quality oversight", "final decisions", "workflow escalation"],
  },
];

type AgentStatus = "ONLINE" | "IDLE" | "WORKING" | "OFFLINE";

function normalizeAgentStatus(status: string | null | undefined): AgentStatus {
  const normalized = String(status || "")
    .trim()
    .toUpperCase();
  if (normalized === "ONLINE") return "ONLINE";
  if (normalized === "IDLE") return "IDLE";
  if (normalized === "WORKING") return "WORKING";
  return "OFFLINE";
}

function collectWriterDiagnostics(writers: Doc<"agents">[]) {
  return {
    writerCount: writers.length,
    writerOnline: writers.filter((agent) => normalizeAgentStatus(agent.status) === "ONLINE").length,
    writerIdle: writers.filter((agent) => normalizeAgentStatus(agent.status) === "IDLE").length,
    writerWorking: writers.filter((agent) => normalizeAgentStatus(agent.status) === "WORKING").length,
    writerOffline: writers.filter((agent) => normalizeAgentStatus(agent.status) === "OFFLINE").length,
  };
}

function pickAssignableWriterId(writers: Doc<"agents">[]): Id<"agents"> | null {
  const online = writers.find((agent) => normalizeAgentStatus(agent.status) === "ONLINE");
  if (online) return online._id;
  const idle = writers.find((agent) => normalizeAgentStatus(agent.status) === "IDLE");
  if (idle) return idle._id;
  return null;
}

function strictProjectAgentPoolsEnabled(): boolean {
  const mode = String(process.env.PROJECT_AGENT_POOL_MODE ?? DEFAULT_PROJECT_AGENT_POOL_MODE)
    .trim()
    .toLowerCase();
  return !["legacy", "shared", "global", "0", "false", "off"].includes(mode);
}

function isAgentLaneKey(value: unknown): value is AgentLaneKey {
  return value === "blog" || value === "collection" || value === "product" || value === "landing";
}

function resolveLaneFromContentType(contentType?: string): AgentLaneKey {
  const normalized = String(contentType || "")
    .trim()
    .toLowerCase();
  if (normalized === "product_category") return "collection";
  if (normalized === "product_description") return "product";
  return "blog";
}

function resolveLaneFromTags(tags?: string[]): AgentLaneKey {
  const lowered = (tags || []).map((tag) => String(tag).toLowerCase());
  if (lowered.some((tag) => tag === "page:collection")) return "collection";
  if (lowered.some((tag) => tag === "page:product")) return "product";
  if (
    lowered.some(
      (tag) => tag === "page:landing_page" || tag === "page:homepage" || tag === "page:faq"
    )
  ) {
    return "landing";
  }
  return "blog";
}

function isAgentRoutableForProject(
  agent: Doc<"agents">,
  projectId: number | undefined
): boolean {
  const health = (agent.assignmentHealth as Record<string, unknown> | undefined) || {};
  if (health.routable === false) return false;

  // Topic workflow assignments are project-scoped: never cross projects.
  if (projectId !== undefined && agent.projectId !== projectId) return false;

  if (!strictProjectAgentPoolsEnabled()) {
    return true;
  }

  if (projectId === undefined) return false;
  if (agent.isDedicated === false) return false;
  return true;
}

function isAgentRoutableForStage(args: {
  agent: Doc<"agents">;
  stage: TopicStageKey;
  projectId: number | undefined;
  laneKey?: AgentLaneKey;
}): boolean {
  if (!isAgentRoutableForProject(args.agent, args.projectId)) return false;
  if (args.stage === "writing") {
    if (!args.laneKey) return false;
    if (!isAgentLaneKey(args.agent.laneKey)) return false;
    return args.agent.laneKey === args.laneKey;
  }
  return true;
}

function stageOwnerSummary(stage: TopicStageKey): string {
  const chain = stageOwnerChains[stage] || ["lead"];
  if (chain.length === 0) return "none";
  if (chain.length === 1) return chain[0];
  return `${chain[0]} (fallback: ${chain.slice(1).join(" -> ")})`;
}

function normalizeTopicKey(topic: string): string {
  return topic
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 140);
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function resolveWriterLockTimeoutMs(): number {
  const parsed = Number.parseInt(
    String(process.env.WORKFLOW_WRITER_LOCK_TIMEOUT_MINUTES ?? ""),
    10
  );
  if (!Number.isFinite(parsed)) return DEFAULT_WRITER_LOCK_TIMEOUT_MS;
  const minutes = clampNumber(parsed, 2, 60);
  return minutes * 60 * 1000;
}

function isTopicTask(task: Doc<"tasks"> | null | undefined): task is Doc<"tasks"> {
  return Boolean(task && task.workflowTemplateKey === WORKFLOW_TEMPLATE_KEY);
}

function stageToTaskStatus(stage: TopicStageKey): string {
  switch (stage) {
    case "research":
    case "seo_intel_review":
    case "outline_build":
    case "outline_review":
    case "prewrite_context":
    case "writing":
    case "editing":
      return "IN_PROGRESS";
    case "final_review":
    case "human_review":
      return "IN_REVIEW";
    case "complete":
      return "COMPLETED";
    default:
      return "BACKLOG";
  }
}

function stageToWorkflowStageStatus(stage: TopicStageKey): string {
  if (stage === "complete") return "complete";
  if (stage === "human_review") return "needs_input";
  return "in_progress";
}

function approvalsWithDefaults(task: Doc<"tasks">) {
  return {
    outlineHuman: task.workflowApprovals?.outlineHuman ?? false,
    outlineSeo: task.workflowApprovals?.outlineSeo ?? false,
    seoFinal: task.workflowApprovals?.seoFinal ?? false,
    outlineSkipped: task.workflowApprovals?.outlineSkipped ?? false,
  };
}

function flagsWithDefaults(task: Doc<"tasks">) {
  return {
    outlineReviewOptional: task.workflowFlags?.outlineReviewOptional ?? true,
    seoReviewRequired: task.workflowFlags?.seoReviewRequired ?? true,
  };
}

function normalizedRoleCandidates(role: string): string[] {
  const roleKey = role.toLowerCase();
  const base = roleAliases[roleKey] || [roleKey];
  return Array.from(new Set([roleKey, ...base]));
}

function isAgentRoleAllowedForStage(stage: TopicStageKey, role: string): boolean {
  const normalizedRole = String(role || "").toLowerCase();
  const chain = stageOwnerChains[stage] || [];
  for (const requestedRole of chain) {
    if (requestedRole === "human") continue;
    if (normalizedRoleCandidates(requestedRole).includes(normalizedRole)) {
      return true;
    }
  }
  return false;
}

async function seedMissingWorkflowRoles(
  ctx: MutationCtx,
  roles?: string[],
  projectId?: number
): Promise<{ seededRoles: string[] }> {
  const existing = await ctx.db.query("agents").collect();
  const wanted = roles
    ? new Set(roles.map((role) => role.toLowerCase()))
    : null;
  const now = Date.now();
  const seededRoles: string[] = [];
  const strictPools = strictProjectAgentPoolsEnabled();

  for (const template of WORKFLOW_ROLE_SEEDS) {
    if (wanted && !wanted.has(template.role.toLowerCase())) continue;
    if (strictPools && template.role.toLowerCase() === "writer" && projectId !== undefined) {
      // Strict pools rely on runtime reconciliation + configured-slot routing.
      // Do not seed writers from workflow mutation paths.
      continue;
    }

    const hasRoleAlready = existing.some(
      (agent) =>
        agent.role.toLowerCase() === template.role.toLowerCase() &&
        (projectId === undefined || agent.projectId === projectId) &&
        isAgentRoutableForProject(agent, projectId)
    );
    if (hasRoleAlready) continue;

    const slotKey =
      strictPools && projectId !== undefined ? `p${projectId}:${template.role}:1` : undefined;
    await ctx.db.insert("agents", {
      name: template.name,
      role: template.role,
      specialization: template.specialization,
      skills: template.skills,
      status: "ONLINE",
      projectId: projectId,
      isDedicated: strictPools ? true : false,
      capacityWeight: 1,
      laneKey: undefined,
      laneProfileKey: undefined,
      slotKey,
      assignmentHealth: strictPools
        ? { routable: true, strictIsolation: true }
        : { routable: true, legacyGlobal: true },
      tasksCompleted: 0,
      createdAt: now,
      updatedAt: now,
    });
    seededRoles.push(template.role);
  }

  return { seededRoles };
}

async function healWriterAvailability(
  ctx: MutationCtx,
  projectId?: number,
  laneKey?: AgentLaneKey
): Promise<{
  healed: boolean;
  assignableWriterId: Id<"agents"> | null;
  reasonCode:
    | "writer_available"
    | "writer_seeded"
    | "writer_status_recovered"
    | "writer_still_unavailable";
  diagnostics: {
    writerCount: number;
    writerOnline: number;
    writerIdle: number;
    writerWorking: number;
    writerOffline: number;
  };
}> {
  const needsLane = strictProjectAgentPoolsEnabled();
  const laneMatcher = (agent: Doc<"agents">) =>
    !needsLane || (laneKey ? agent.laneKey === laneKey : true);
  const allAgents = await ctx.db.query("agents").collect();
  let writers = allAgents.filter(
    (agent) =>
      agent.role.toLowerCase() === "writer" &&
      isAgentRoutableForProject(agent, projectId) &&
      laneMatcher(agent)
  );

  if (writers.length === 0) {
    if (strictProjectAgentPoolsEnabled()) {
      return {
        healed: false,
        assignableWriterId: null,
        reasonCode: "writer_still_unavailable",
        diagnostics: collectWriterDiagnostics(writers),
      };
    }
    await seedMissingWorkflowRoles(ctx, ["writer"], projectId);
    const refreshed = await ctx.db.query("agents").collect();
    writers = refreshed.filter(
      (agent) =>
        agent.role.toLowerCase() === "writer" &&
        isAgentRoutableForProject(agent, projectId) &&
        laneMatcher(agent)
    );
    const assignableWriterId = pickAssignableWriterId(writers);
    return {
      healed: true,
      assignableWriterId,
      reasonCode: Boolean(assignableWriterId)
        ? "writer_seeded"
        : "writer_still_unavailable",
      diagnostics: collectWriterDiagnostics(writers),
    };
  }

  const alreadyAssignableWriterId = pickAssignableWriterId(writers);
  if (alreadyAssignableWriterId) {
    return {
      healed: false,
      assignableWriterId: alreadyAssignableWriterId,
      reasonCode: "writer_available",
      diagnostics: collectWriterDiagnostics(writers),
    };
  }

  let recoveredAny = false;
  const now = Date.now();
  const writerLockTimeoutMs = resolveWriterLockTimeoutMs();
  for (const writer of writers) {
    const writerStatus = normalizeAgentStatus(writer.status);

    if (writerStatus === "OFFLINE") {
      await ctx.db.patch(writer._id, {
        status: "IDLE",
        currentTaskId: undefined,
        updatedAt: now,
      });
      recoveredAny = true;
      continue;
    }

    if (writerStatus !== "WORKING") continue;

    let staleWorking = false;
    if (!writer.currentTaskId) {
      staleWorking = true;
    } else {
      const currentTask = await ctx.db.get(writer.currentTaskId);
      staleWorking =
        !currentTask ||
        currentTask.status === "COMPLETED" ||
        currentTask.workflowCurrentStageKey === "complete";

      // Recover stale writer locks when writer status remains WORKING but the
      // linked task is no longer actively executing the writing stage.
      if (!staleWorking && currentTask) {
        const taskStage = (currentTask.workflowCurrentStageKey || "research") as TopicStageKey;
        const taskStageStatus = currentTask.workflowStageStatus || "in_progress";
        const taskStillWriting =
          taskStage === "writing" &&
          taskStageStatus === "in_progress" &&
          currentTask.status === "IN_PROGRESS";
        if (!taskStillWriting) {
          staleWorking = true;
        } else {
          const lastTaskTouch =
            currentTask.workflowLastEventAt ||
            currentTask.workflowUpdatedAt ||
            currentTask.updatedAt ||
            0;
          if (lastTaskTouch > 0 && now - lastTaskTouch > writerLockTimeoutMs) {
            staleWorking = true;
          }
        }
      }
    }

    if (staleWorking) {
      await ctx.db.patch(writer._id, {
        status: "IDLE",
        currentTaskId: undefined,
        updatedAt: now,
      });
      recoveredAny = true;
    }
  }

  const refreshed = await ctx.db.query("agents").collect();
  const refreshedWriters = refreshed.filter(
    (agent) =>
      agent.role.toLowerCase() === "writer" &&
      isAgentRoutableForProject(agent, projectId) &&
      laneMatcher(agent)
  );
  const assignableWriterId = pickAssignableWriterId(refreshedWriters);
  const hasAssignable = Boolean(assignableWriterId);

  return {
    healed: recoveredAny,
    assignableWriterId,
    reasonCode: hasAssignable
      ? recoveredAny
        ? "writer_status_recovered"
        : "writer_available"
      : "writer_still_unavailable",
    diagnostics: collectWriterDiagnostics(refreshedWriters),
  };
}

/**
 * Generalized agent availability healing for non-writer stages.
 * Recovers OFFLINE agents to IDLE and resets WORKING agents whose
 * current task is complete, blocked, or no longer actively executing.
 */
async function healAgentAvailability(
  ctx: MutationCtx,
  stageKey: TopicStageKey,
  projectId?: number
): Promise<{ healed: boolean; recoveredCount: number }> {
  const chain = stageOwnerChains[stageKey] || [];
  if (chain.length === 0) return { healed: false, recoveredCount: 0 };

  const allAgents = await ctx.db.query("agents").collect();
  const now = Date.now();
  const lockTimeoutMs = resolveWriterLockTimeoutMs(); // reuse same timeout
  let recoveredCount = 0;

  for (const requestedRole of chain) {
    if (requestedRole === "human") continue;
    const candidates = normalizedRoleCandidates(requestedRole);
    const roleAgents = allAgents.filter(
      (agent) =>
        candidates.includes(agent.role.toLowerCase()) &&
        isAgentRoutableForProject(agent, projectId)
    );

    for (const agent of roleAgents) {
      const status = normalizeAgentStatus(agent.status);

      if (status === "OFFLINE") {
        await ctx.db.patch(agent._id, {
          status: "IDLE",
          currentTaskId: undefined,
          updatedAt: now,
        });
        recoveredCount++;
        continue;
      }

      if (status !== "WORKING") continue;

      let stale = false;
      if (!agent.currentTaskId) {
        stale = true;
      } else {
        const task = await ctx.db.get(agent.currentTaskId);
        if (
          !task ||
          task.status === "COMPLETED" ||
          task.workflowCurrentStageKey === "complete"
        ) {
          stale = true;
        } else {
          // Agent WORKING but task is blocked/queued/pending — release
          const taskStageStatus = task.workflowStageStatus || "in_progress";
          if (taskStageStatus === "blocked" || taskStageStatus === "queued" || taskStageStatus === "pending") {
            stale = true;
          } else {
            // Check for stale lock by time
            const lastTouch =
              task.workflowLastEventAt || task.workflowUpdatedAt || task.updatedAt || 0;
            if (lastTouch > 0 && now - lastTouch > lockTimeoutMs) {
              stale = true;
            }
          }
        }
      }

      if (stale) {
        await ctx.db.patch(agent._id, {
          status: "IDLE",
          currentTaskId: undefined,
          updatedAt: now,
        });
        recoveredCount++;
      }
    }
  }

  return { healed: recoveredCount > 0, recoveredCount };
}

async function healConfiguredWriterSlotAvailability(
  ctx: MutationCtx,
  args: {
    task: Doc<"tasks">;
    slotKey: string;
    projectId?: number;
    laneKey?: AgentLaneKey;
  }
): Promise<{ healed: boolean; reasonCode: string; diagnostics?: Record<string, unknown> }> {
  const rows = await ctx.db
    .query("agents")
    .withIndex("by_slot", (q) => q.eq("slotKey", args.slotKey))
    .collect();

  const writer = rows.find((agent) => {
    if (
      !isAgentRoutableForStage({
        agent,
        stage: "writing",
        projectId: args.projectId,
        laneKey: args.laneKey,
      })
    ) {
      return false;
    }
    return normalizedRoleCandidates("writer").includes(agent.role.toLowerCase());
  });

  if (!writer) {
    return {
      healed: false,
      reasonCode: "configured_writer_missing",
      diagnostics: { slotKey: args.slotKey },
    };
  }

  let stale = false;
  const now = Date.now();
  const writerLockTimeoutMs = resolveWriterLockTimeoutMs();
  const status = normalizeAgentStatus(writer.status);
  if (status === "OFFLINE") {
    stale = true;
  } else if (status === "WORKING") {
    if (!writer.currentTaskId) {
      stale = true;
    } else {
      const currentTask = await ctx.db.get(writer.currentTaskId);
      if (!currentTask) {
        stale = true;
      } else {
        const taskStage = (currentTask.workflowCurrentStageKey || "research") as TopicStageKey;
        const taskStageStatus = currentTask.workflowStageStatus || "in_progress";
        const stillWriting =
          taskStage === "writing" &&
          taskStageStatus === "in_progress" &&
          currentTask.status === "IN_PROGRESS";
        if (!stillWriting) {
          stale = true;
        } else {
          const lastTouch =
            currentTask.workflowLastEventAt ||
            currentTask.workflowUpdatedAt ||
            currentTask.updatedAt ||
            0;
          if (lastTouch > 0 && now - lastTouch > writerLockTimeoutMs) {
            stale = true;
          }
        }
      }
    }
  }

  if (!stale) {
    return {
      healed: false,
      reasonCode: "configured_writer_healthy",
      diagnostics: { slotKey: args.slotKey, status },
    };
  }

  await ctx.db.patch(writer._id, {
    status: "IDLE",
    currentTaskId: undefined,
    updatedAt: now,
  });

  return {
    healed: true,
    reasonCode: "configured_writer_stale_recovered",
    diagnostics: {
      slotKey: args.slotKey,
      writerId: writer._id,
      writerName: writer.name,
      previousStatus: status,
    },
  };
}

function outlinePayloadLooksValid(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const p = payload as {
    artifact?: {
      data?: {
        sections?: unknown;
        headings?: unknown;
        outlineSnapshot?: {
          headingCount?: unknown;
          headings?: unknown;
        };
      };
    };
  };
  const data = p.artifact?.data;
  if (!data || typeof data !== "object") return false;

  const headingCount = Number(
    (data as { outlineSnapshot?: { headingCount?: unknown } }).outlineSnapshot?.headingCount ??
      (data as { sections?: unknown }).sections ??
      0
  );
  if (Number.isFinite(headingCount) && headingCount > 0) return true;

  const headings =
    (data as { outlineSnapshot?: { headings?: unknown } }).outlineSnapshot?.headings ??
    (data as { headings?: unknown }).headings;

  return Array.isArray(headings) && headings.some((item) => String(item || "").trim().length > 0);
}

async function hasValidOutlineArtifact(
  ctx: MutationCtx,
  taskId: Id<"tasks">
): Promise<boolean> {
  const events = await ctx.db
    .query("taskWorkflowEvents")
    .withIndex("by_task_time", (q) => q.eq("taskId", taskId))
    .order("desc")
    .take(80);

  return events.some(
    (event) =>
      event.stageKey === "outline_build" &&
      event.eventType === "stage_artifact" &&
      outlinePayloadLooksValid(event.payload)
  );
}

function readConfiguredStageOwner(
  task: Doc<"tasks">,
  stage: TopicStageKey
): {
  configured: boolean;
  slotKey: string | null;
  enabled: boolean;
  laneKey: AgentLaneKey | null;
  agentName: string | null;
  agentRole: string | null;
} {
  const plan =
    task.workflowStagePlan && typeof task.workflowStagePlan === "object"
      ? (task.workflowStagePlan as Record<string, unknown>)
      : null;
  const owners =
    plan?.owners && typeof plan.owners === "object"
      ? (plan.owners as Record<string, unknown>)
      : null;
  const stageOwner =
    owners?.[stage] && typeof owners[stage] === "object"
      ? (owners[stage] as Record<string, unknown>)
      : null;
  const slotKey =
    typeof stageOwner?.slotKey === "string" && stageOwner.slotKey.trim().length > 0
      ? stageOwner.slotKey.trim()
      : null;
  const enabled =
    stageOwner?.enabled === undefined
      ? true
      : stageOwner.enabled === true || String(stageOwner.enabled).toLowerCase() === "true";
  const configuredLane =
    stageOwner?.laneKey && isAgentLaneKey(stageOwner.laneKey) ? stageOwner.laneKey : null;
  const agentName =
    typeof stageOwner?.agentName === "string" && stageOwner.agentName.trim().length > 0
      ? stageOwner.agentName.trim()
      : null;
  const agentRole =
    typeof stageOwner?.agentRole === "string" && stageOwner.agentRole.trim().length > 0
      ? stageOwner.agentRole.trim()
      : null;

  return {
    configured: Boolean(stageOwner),
    slotKey,
    enabled,
    laneKey: configuredLane,
    agentName,
    agentRole,
  };
}

async function resolveConfiguredStageOwnerAgent(
  ctx: MutationCtx,
  args: {
    task: Doc<"tasks">;
    stage: TopicStageKey;
    projectId?: number;
    laneKey?: AgentLaneKey;
    slotKey: string;
  }
): Promise<{ agent: Doc<"agents">; requestedRole: string; matchedRole: string } | null> {
  const rows = await ctx.db
    .query("agents")
    .withIndex("by_slot", (q) => q.eq("slotKey", args.slotKey))
    .collect();

  const agent =
    rows.find(
      (candidate) =>
        isAgentRoutableForStage({
          agent: candidate,
          stage: args.stage,
          projectId: args.projectId,
          laneKey: args.laneKey,
        }) &&
        isAgentRoleAllowedForStage(args.stage, candidate.role) &&
        normalizeAgentStatus(candidate.status) === "ONLINE"
    ) ||
    rows.find(
      (candidate) =>
        isAgentRoutableForStage({
          agent: candidate,
          stage: args.stage,
          projectId: args.projectId,
          laneKey: args.laneKey,
        }) &&
        isAgentRoleAllowedForStage(args.stage, candidate.role) &&
        normalizeAgentStatus(candidate.status) === "IDLE"
    ) ||
    rows.find((candidate) => {
      if (
        !isAgentRoutableForStage({
          agent: candidate,
          stage: args.stage,
          projectId: args.projectId,
          laneKey: args.laneKey,
        })
      ) {
        return false;
      }
      if (!isAgentRoleAllowedForStage(args.stage, candidate.role)) return false;
      const status = normalizeAgentStatus(candidate.status);
      return status === "WORKING" && candidate.currentTaskId === args.task._id;
    });

  if (!agent) return null;
  return {
    agent,
    requestedRole: stageOwnerChains[args.stage]?.[0] || "configured",
    matchedRole: agent.role,
  };
}

async function resolveStageOwnerAgent(
  ctx: MutationCtx,
  stage: TopicStageKey,
  projectId?: number,
  laneKey?: AgentLaneKey
): Promise<{ agent: Doc<"agents">; requestedRole: string; matchedRole: string } | null> {
  const chain = stageOwnerChains[stage] || [];
  if (chain.length === 0) return null;

  const allAgents = await ctx.db.query("agents").collect();

  for (const requestedRole of chain) {
    if (requestedRole === "human") continue;

    const candidates = normalizedRoleCandidates(requestedRole);
    const byRole = allAgents.filter(
      (agent) =>
        candidates.includes(agent.role.toLowerCase()) &&
        isAgentRoutableForStage({
          agent,
          stage,
          projectId,
          laneKey,
        })
    );
    const online = byRole.find((agent) => normalizeAgentStatus(agent.status) === "ONLINE");
    if (online) {
      return { agent: online, requestedRole, matchedRole: online.role };
    }

    const idle = byRole.find((agent) => normalizeAgentStatus(agent.status) === "IDLE");
    if (idle) {
      return { agent: idle, requestedRole, matchedRole: idle.role };
    }
  }

  return null;
}

async function postWorkflowDiscussion(
  ctx: MutationCtx,
  args: {
    taskId: Id<"tasks">;
    projectId?: number;
    actorType: "user" | "agent" | "system";
    actorId?: string;
    actorName?: string;
    summary: string;
  }
) {
  const authorType = args.actorType === "user" ? "user" : "agent";
  const authorId =
    args.actorId ||
    (args.actorType === "user" ? "workflow-user" : "workflow-system");
  const authorName =
    args.actorName ||
    (args.actorType === "user" ? "User" : "Workflow PM");

  await ctx.db.insert("messages", {
    taskId: args.taskId,
    projectId: args.projectId,
    authorType,
    authorId,
    authorName,
    content: args.summary,
    createdAt: Date.now(),
  });

  await ctx.db.insert("activities", {
    type: "workflow_event",
    taskId: args.taskId,
    description: args.summary,
    projectId: args.projectId,
    metadata: { actorType: args.actorType, actorId: args.actorId, actorName: args.actorName },
    createdAt: Date.now(),
  });
}

async function insertWorkflowEvent(
  ctx: MutationCtx,
  args: {
    taskId: Id<"tasks">;
    projectId?: number;
    stageKey: TopicStageKey;
    eventType: string;
    summary: string;
    fromStageKey?: TopicStageKey;
    toStageKey?: TopicStageKey;
    actorType: "user" | "agent" | "system";
    actorId?: string;
    actorName?: string;
    payload?: unknown;
  }
) {
  const createdAt = Date.now();
  const task = await ctx.db.get(args.taskId);
  const laneKey = isAgentLaneKey(task?.workflowLaneKey) ? task?.workflowLaneKey : undefined;
  const mergedPayload =
    args.payload && typeof args.payload === "object"
      ? { laneKey: laneKey || null, ...(args.payload as Record<string, unknown>) }
      : laneKey
        ? { laneKey, value: args.payload }
        : args.payload;
  await ctx.db.insert("taskWorkflowEvents", {
    taskId: args.taskId,
    projectId: args.projectId,
    stageKey: args.stageKey,
    eventType: args.eventType,
    fromStageKey: args.fromStageKey,
    toStageKey: args.toStageKey,
    actorType: args.actorType,
    actorId: args.actorId,
    actorName: args.actorName,
    summary: args.summary,
    payload: mergedPayload,
    createdAt,
  });

  await ctx.db.patch(args.taskId, {
    workflowLastEventAt: createdAt,
    workflowLastEventText: args.summary,
    workflowUpdatedAt: createdAt,
    updatedAt: createdAt,
  });

  await postWorkflowDiscussion(ctx, {
    taskId: args.taskId,
    projectId: args.projectId,
    actorType: args.actorType,
    actorId: args.actorId,
    actorName: args.actorName,
    summary: args.summary,
  });
}

async function insertHandoffEvent(
  ctx: MutationCtx,
  args: {
    taskId: Id<"tasks">;
    projectId?: number;
    stageKey: TopicStageKey;
    fromStageKey?: TopicStageKey;
    actorType?: "user" | "agent" | "system";
    actorId?: string;
    actorName?: string;
  }
) {
  await insertWorkflowEvent(ctx, {
    taskId: args.taskId,
    projectId: args.projectId,
    stageKey: args.stageKey,
    eventType: "handoff",
    fromStageKey: args.fromStageKey,
    toStageKey: args.stageKey,
    actorType: args.actorType || "system",
    actorId: args.actorId,
    actorName: args.actorName || "Workflow PM",
    summary: `PM handoff: ${args.stageKey} owned by ${stageOwnerSummary(args.stageKey)}.`,
    payload: {
      ownerChain: stageOwnerChains[args.stageKey],
    },
  });
}

async function assignStageOwner(
  ctx: MutationCtx,
  args: {
    taskId: Id<"tasks">;
    projectId?: number;
    stageKey: TopicStageKey;
    laneKey?: AgentLaneKey;
  }
) {
    const currentTask = await ctx.db.get(args.taskId);
  if (!currentTask) {
    return {
      blocked: true,
      queued: false,
      queueReason: null as string | null,
      configuredSlotKey: null as string | null,
      configuredAgentName: null as string | null,
      configuredWriterStatus: null as string | null,
      repairAttempted: false,
      repairOutcomeCode: null as string | null,
      assignedAgentId: null as Id<"agents"> | null,
      assignedAgentName: null as string | null,
    };
  }

  const stageOwnerChain = stageOwnerChains[args.stageKey] || [];
  const assignableRoles = stageOwnerChain.filter((role) => role !== "human");
  if (assignableRoles.length === 0) {
    const stageStatus =
      args.stageKey === "complete"
        ? "complete"
        : args.stageKey === "human_review"
          ? "needs_input"
          : "in_progress";
    await ctx.db.patch(args.taskId, {
      assignedAgentId: undefined,
      workflowStageStatus: stageStatus,
      workflowUpdatedAt: Date.now(),
      updatedAt: Date.now(),
    });
    return {
      blocked: false,
      queued: false,
      queueReason: null as string | null,
      configuredSlotKey: null as string | null,
      configuredAgentName: null as string | null,
      configuredWriterStatus: null as string | null,
      repairAttempted: false,
      repairOutcomeCode: null as string | null,
      assignedAgentId: null as Id<"agents"> | null,
      assignedAgentName: null as string | null,
    };
  }

  const now = Date.now();
  const laneKey =
    args.laneKey ||
    (isAgentLaneKey(currentTask.workflowLaneKey) ? currentTask.workflowLaneKey : undefined);
  const configuredOwner = readConfiguredStageOwner(currentTask, args.stageKey);
  const strictConfiguredStage =
    configuredOwner.configured &&
    ROUTABLE_CONFIGURED_STAGES.has(args.stageKey as RoutableStageKey);
  const effectiveLaneKey = configuredOwner.laneKey || laneKey;
  const strictConfiguredWriterStage = strictConfiguredStage && args.stageKey === "writing";
  let assignment = await resolveStageOwnerAgent(ctx, args.stageKey, args.projectId, laneKey);
  let assignmentDiagnostics: Record<string, unknown> | undefined;
  let writerHealResult: Awaited<ReturnType<typeof healWriterAvailability>> | undefined;
  let configuredWriterStatus: string | null = null;
  let repairAttempted = false;
  let repairOutcomeCode: string | null = null;

  if (strictConfiguredStage) {
    assignment = null;
    assignmentDiagnostics = {
      configuredRouting: true,
      configuredSlotKey: configuredOwner.slotKey,
      configuredAgentName: configuredOwner.agentName,
      configuredAgentRole: configuredOwner.agentRole,
      configuredEnabled: configuredOwner.enabled,
      laneKey: effectiveLaneKey || null,
    };

    if (!configuredOwner.enabled) {
      assignmentDiagnostics.reasonCode = "configured_stage_disabled";
    } else if (!configuredOwner.slotKey) {
      assignmentDiagnostics.reasonCode = "configured_slot_missing";
    } else {
      assignment = await resolveConfiguredStageOwnerAgent(ctx, {
        task: currentTask,
        stage: args.stageKey,
        projectId: args.projectId,
        laneKey: effectiveLaneKey,
        slotKey: configuredOwner.slotKey,
      });
      if (assignment && strictConfiguredWriterStage) {
        configuredWriterStatus = normalizeAgentStatus(assignment.agent.status);
      }
      if (!assignment) {
        assignmentDiagnostics.reasonCode = strictConfiguredWriterStage
          ? "configured_writer_unavailable_after_repair"
          : "configured_agent_unavailable";
        if (strictConfiguredWriterStage) {
          repairAttempted = true;
          const slotHeal = await healConfiguredWriterSlotAvailability(ctx, {
            task: currentTask,
            slotKey: configuredOwner.slotKey,
            projectId: args.projectId,
            laneKey: effectiveLaneKey,
          });
          repairOutcomeCode = slotHeal.reasonCode;
          const slotHealDiagnostics =
            slotHeal.diagnostics && typeof slotHeal.diagnostics === "object"
              ? (slotHeal.diagnostics as Record<string, unknown>)
              : null;
          configuredWriterStatus =
            typeof slotHealDiagnostics?.status === "string"
              ? String(slotHealDiagnostics.status)
              : typeof slotHealDiagnostics?.previousStatus === "string"
                ? String(slotHealDiagnostics.previousStatus)
                : configuredWriterStatus;
          assignmentDiagnostics.slotHeal = slotHeal;
          assignmentDiagnostics.repairAttempted = true;
          assignmentDiagnostics.repairOutcomeCode = slotHeal.reasonCode;
          assignmentDiagnostics.configuredWriterStatus = configuredWriterStatus;
          if (slotHeal.healed) {
            assignment = await resolveConfiguredStageOwnerAgent(ctx, {
              task: currentTask,
              stage: args.stageKey,
              projectId: args.projectId,
              laneKey: effectiveLaneKey,
              slotKey: configuredOwner.slotKey,
            });
            if (assignment) {
              assignmentDiagnostics.reasonCode = "configured_writer_stale_recovered";
              configuredWriterStatus = normalizeAgentStatus(assignment.agent.status);
              repairOutcomeCode = "configured_writer_stale_recovered";
            }
          }
          if (!assignment) {
            assignmentDiagnostics.reasonCode =
              slotHeal.reasonCode === "configured_writer_missing"
                ? "configured_slot_missing"
                : "configured_writer_unavailable_after_repair";
          }
        }
      }
    }
  }

  if (!strictConfiguredStage && !assignment && args.stageKey === "writing") {
    const healResult = await healWriterAvailability(ctx, args.projectId, laneKey);
    writerHealResult = healResult;
    assignmentDiagnostics = {
      reasonCode: healResult.reasonCode,
      ...healResult.diagnostics,
      healed: healResult.healed,
      laneKey: laneKey || null,
    };
    assignment = await resolveStageOwnerAgent(ctx, args.stageKey, args.projectId, laneKey);
    if (!assignment && healResult.assignableWriterId) {
      const healedWriter = await ctx.db.get(healResult.assignableWriterId);
      if (
        healedWriter &&
        normalizedRoleCandidates("writer").includes(healedWriter.role.toLowerCase()) &&
        (!laneKey || healedWriter.laneKey === laneKey)
      ) {
        assignment = {
          agent: healedWriter,
          requestedRole: "writer",
          matchedRole: healedWriter.role,
        };
      }
    }
  }

  // Generalized healing for non-writing stages (editing, final_review, etc.)
  if (!strictConfiguredStage && !assignment && args.stageKey !== "writing") {
    const generalHeal = await healAgentAvailability(ctx, args.stageKey, args.projectId);
    if (generalHeal.healed) {
      assignmentDiagnostics = {
        ...assignmentDiagnostics,
        generalHealRecovered: generalHeal.recoveredCount,
      };
      // Retry assignment after healing
      assignment = await resolveStageOwnerAgent(ctx, args.stageKey, args.projectId, laneKey);
    }
  }

  // Strict routing fallthrough: configured slot failed → try general pool
  if (strictConfiguredStage && !assignment) {
    assignment = await resolveStageOwnerAgent(ctx, args.stageKey, args.projectId, effectiveLaneKey);
    if (!assignment && args.stageKey === "writing") {
      const healResult = await healWriterAvailability(ctx, args.projectId, effectiveLaneKey);
      if (healResult.healed || healResult.assignableWriterId) {
        assignment = await resolveStageOwnerAgent(ctx, args.stageKey, args.projectId, effectiveLaneKey);
        if (!assignment && healResult.assignableWriterId) {
          const w = await ctx.db.get(healResult.assignableWriterId);
          if (w && normalizedRoleCandidates("writer").includes(w.role.toLowerCase())) {
            assignment = { agent: w, requestedRole: "writer", matchedRole: w.role };
          }
        }
      }
    }
    if (!assignment && args.stageKey !== "writing") {
      const gh = await healAgentAvailability(ctx, args.stageKey, args.projectId);
      if (gh.healed) {
        assignment = await resolveStageOwnerAgent(ctx, args.stageKey, args.projectId, laneKey);
      }
    }
    if (assignment) {
      assignmentDiagnostics = { ...assignmentDiagnostics, reasonCode: "configured_fallthrough_pool", fallthroughUsed: true };
    }
  }

  if (!assignment) {
    const queueTask =
      strictConfiguredStage ||
      args.stageKey === "writing" ||
      args.stageKey === "research" ||
      args.stageKey === "seo_intel_review" ||
      args.stageKey === "outline_build" ||
      args.stageKey === "editing" ||
      args.stageKey === "final_review";
    await ctx.db.patch(args.taskId, {
      assignedAgentId: undefined,
      workflowStageStatus: queueTask ? "queued" : "blocked",
      status: queueTask ? "PENDING" : currentTask.status,
      workflowUpdatedAt: now,
      updatedAt: now,
    });

    const reasonCode =
      (assignmentDiagnostics?.reasonCode as string | undefined) ||
      (strictConfiguredStage
        ? strictConfiguredWriterStage
          ? "configured_writer_unavailable_after_repair"
          : "configured_agent_unavailable"
        : args.stageKey === "writing"
          ? "writer_lane_unavailable"
          : "assignment_unavailable");
    const summary = queueTask
      ? strictConfiguredStage
        ? `PM assignment queued: configured owner unavailable for ${args.stageKey}. waiting on slot ${configuredOwner.slotKey || "unconfigured"}${effectiveLaneKey ? ` (${effectiveLaneKey} lane)` : ""}.`
        : `PM writer queue: waiting for available ${laneKey || "writer"} lane writer on ${args.stageKey}. owner chain: ${stageOwnerSummary(args.stageKey)}.`
      : `PM assignment blocked: no available agent for ${args.stageKey}. required owner chain: ${stageOwnerSummary(args.stageKey)}.`;
    await insertWorkflowEvent(ctx, {
      taskId: args.taskId,
      projectId: args.projectId,
      stageKey: args.stageKey,
      eventType: queueTask ? "assignment_queued" : "assignment_blocked",
      actorType: "system",
      actorName: "Workflow PM",
      summary,
      payload: {
        reasonCode,
        requiredOwnerChain: stageOwnerChains[args.stageKey],
        strictProjectPools: strictProjectAgentPoolsEnabled(),
        projectId: args.projectId,
        laneKey: effectiveLaneKey || null,
        configuredRouting: strictConfiguredStage,
        configuredSlotKey: configuredOwner.slotKey,
        configuredAgentName: configuredOwner.agentName,
        configuredAgentRole: configuredOwner.agentRole,
        configuredWriterStatus,
        repairAttempted,
        repairOutcomeCode,
        queueReason: reasonCode,
        diagnostics: assignmentDiagnostics,
        writerHealResult,
      },
    });

    return {
      blocked: !queueTask,
      queued: queueTask,
      queueReason: reasonCode,
      configuredSlotKey: configuredOwner.slotKey,
      configuredAgentName: configuredOwner.agentName,
      configuredWriterStatus,
      repairAttempted,
      repairOutcomeCode,
      assignedAgentId: null as Id<"agents"> | null,
      assignedAgentName: null as string | null,
    };
  }

  const isInitialResearchAssignment =
    args.stageKey === "research" &&
    (currentTask.status === "BACKLOG" || currentTask.status === "PENDING");
  const assignedStatus = isInitialResearchAssignment ? "PENDING" : currentTask.status;
  const assignedStageStatus = isInitialResearchAssignment ? "active" : "in_progress";

  await ctx.db.patch(args.taskId, {
    assignedAgentId: assignment.agent._id,
    status: assignedStatus,
    workflowStageStatus: assignedStageStatus,
    workflowUpdatedAt: now,
    updatedAt: Date.now(),
  });

  const summary = `PM assigned ${assignment.agent.name} to ${args.stageKey} (requested ${assignment.requestedRole}, matched ${assignment.matchedRole}).`;
  await insertWorkflowEvent(ctx, {
    taskId: args.taskId,
    projectId: args.projectId,
    stageKey: args.stageKey,
    eventType: "assignment",
    actorType: "system",
    actorName: "Workflow PM",
    summary,
    payload: {
      assignedAgentId: assignment.agent._id,
      assignedAgentName: assignment.agent.name,
      requestedRole: assignment.requestedRole,
      matchedRole: assignment.matchedRole,
      laneKey: effectiveLaneKey || null,
      configuredRouting: strictConfiguredStage,
      configuredSlotKey: configuredOwner.slotKey,
      configuredAgentName: configuredOwner.agentName,
      configuredAgentRole: configuredOwner.agentRole,
      configuredWriterStatus:
        configuredWriterStatus || normalizeAgentStatus(assignment.agent.status),
      repairAttempted,
      repairOutcomeCode,
    },
  });

  return {
    blocked: false,
    queued: false,
    queueReason: null as string | null,
    configuredSlotKey: configuredOwner.slotKey,
    configuredAgentName: configuredOwner.agentName,
    configuredWriterStatus:
      configuredWriterStatus || normalizeAgentStatus(assignment.agent.status),
    repairAttempted,
    repairOutcomeCode,
    assignedAgentId: assignment.agent._id,
    assignedAgentName: assignment.agent.name,
    requestedRole: assignment.requestedRole,
    matchedRole: assignment.matchedRole,
  };
}

async function transitionStage(
  ctx: MutationCtx,
  args: {
    task: Doc<"tasks">;
    toStage: TopicStageKey;
    actorType: "user" | "agent" | "system";
    actorId?: string;
    actorName?: string;
    note?: string;
    approvalsOverride?: ReturnType<typeof approvalsWithDefaults>;
  }
) {
  const task = args.task;
  const now = Date.now();
  const currentStage = (task.workflowCurrentStageKey || "research") as TopicStageKey;
  const approvals = args.approvalsOverride ?? approvalsWithDefaults(task);

  const patch: Partial<Doc<"tasks">> & Record<string, unknown> = {
    workflowCurrentStageKey: args.toStage,
    workflowStageStatus: stageToWorkflowStageStatus(args.toStage),
    workflowUpdatedAt: now,
    updatedAt: now,
    status: stageToTaskStatus(args.toStage),
    workflowApprovals: approvals,
    workflowRunNotBeforeAt: args.toStage === "research" ? task.workflowRunNotBeforeAt : undefined,
  };

  if (!task.startedAt && args.toStage !== "complete") {
    patch.startedAt = now;
  }
  if (args.toStage === "complete") {
    patch.workflowCompletedAt = now;
    patch.completedAt = now;
  }

  await ctx.db.patch(task._id, patch);

  const summary =
    args.note ||
    `Workflow stage moved: ${currentStage} -> ${args.toStage}`;
  await insertWorkflowEvent(ctx, {
    taskId: task._id,
    projectId: task.projectId,
    stageKey: args.toStage,
    eventType: "transition",
    fromStageKey: currentStage,
    toStageKey: args.toStage,
    actorType: args.actorType,
    actorId: args.actorId,
    actorName: args.actorName,
    summary,
  });

  await assignStageOwner(ctx, {
    taskId: task._id,
    projectId: task.projectId,
    stageKey: args.toStage,
  });

  await insertHandoffEvent(ctx, {
    taskId: task._id,
    projectId: task.projectId,
    stageKey: args.toStage,
    fromStageKey: currentStage,
    actorType: "system",
    actorName: "Workflow PM",
  });
}

export const createTopicFromSource = mutation({
  args: {
    projectId: v.number(),
    topic: v.string(),
    entryPoint: v.union(
      v.literal("mission_control"),
      v.literal("content_engine"),
      v.literal("keywords"),
      v.literal("pages"),
      v.literal("onboarding")
    ),
    siteId: v.optional(v.number()),
    pageId: v.optional(v.number()),
    keywordId: v.optional(v.number()),
    keywordClusterId: v.optional(v.number()),
    requestedByUserId: v.optional(v.string()),
    documentId: v.optional(v.number()),
    skillId: v.optional(v.number()),
    laneKey: v.optional(laneValidator),
    contentType: v.optional(v.string()),
    contentFormat: v.optional(v.string()),
    pageType: v.optional(v.string()),
    subtype: v.optional(v.string()),
    workflowStagePlan: v.optional(v.any()),
    options: v.optional(
      v.object({
        outlineReviewOptional: v.optional(v.boolean()),
        seoReviewRequired: v.optional(v.boolean()),
        workflowStartDelayMs: v.optional(v.number()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const topicKey = normalizeTopicKey(args.topic);
    const laneKey = isAgentLaneKey(args.laneKey)
      ? args.laneKey
      : resolveLaneFromContentType(args.contentType);
    await seedMissingWorkflowRoles(ctx, undefined, args.projectId);

    const projectTasks = await ctx.db
      .query("tasks")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();

    const existing = projectTasks.find(
      (task) =>
        task.workflowTemplateKey === WORKFLOW_TEMPLATE_KEY &&
        task.topicKey === topicKey &&
        task.workflowCurrentStageKey !== "complete" &&
        !task.workflowCompletedAt
    );

    if (existing) {
      return {
        taskId: existing._id,
        contentDocumentId: existing.documentId,
        workflowStage: (existing.workflowCurrentStageKey || "research") as TopicStageKey,
        laneKey: isAgentLaneKey(existing.workflowLaneKey)
          ? existing.workflowLaneKey
          : resolveLaneFromTags(existing.tags),
        reused: true,
      };
    }

    const outlineReviewOptional = args.options?.outlineReviewOptional ?? true;
    const seoReviewRequired = args.options?.seoReviewRequired ?? true;
    const initialStage: TopicStageKey = "research";
    const startDelayMs = clampNumber(
      args.options?.workflowStartDelayMs ?? INITIAL_WORKFLOW_START_DELAY_MS,
      MIN_WORKFLOW_START_DELAY_MS,
      MAX_WORKFLOW_START_DELAY_MS
    );
    const runNotBeforeAt = now + startDelayMs;
    const initialSummary = `Topic workflow created from ${args.entryPoint}: ${args.topic}`;
    const contentFormat =
      typeof args.contentFormat === "string" && args.contentFormat.trim().length > 0
        ? args.contentFormat.trim()
        : typeof args.contentType === "string" && args.contentType.trim().length > 0
          ? args.contentType.trim()
          : "blog_post";
    const tags = Array.from(
      new Set(
        [
          "topic",
          "workflow",
          args.entryPoint,
          `lane:${laneKey}`,
          `format:${contentFormat}`,
          args.pageType ? `page:${args.pageType}` : null,
          args.subtype ? `subtype:${args.subtype}` : null,
        ].filter(Boolean) as string[]
      )
    );

    const taskId = await ctx.db.insert("tasks", {
      title: args.topic,
      description: `Topic workflow (${args.entryPoint})`,
      type: "content",
      status: "BACKLOG",
      priority: "MEDIUM",
      documentId: args.documentId,
      projectId: args.projectId,
      skillId: args.skillId,
      tags,
      createdAt: now,
      updatedAt: now,
      workflowTemplateKey: WORKFLOW_TEMPLATE_KEY,
      workflowCurrentStageKey: initialStage,
      workflowStageStatus: "active",
      workflowFlags: { outlineReviewOptional, seoReviewRequired },
      workflowApprovals: {
        outlineHuman: false,
        outlineSeo: false,
        seoFinal: false,
        outlineSkipped: false,
      },
      workflowStartedAt: now,
      workflowUpdatedAt: now,
      workflowLastEventAt: now,
      workflowLastEventText: initialSummary,
      workflowRunNotBeforeAt: runNotBeforeAt,
      workflowLaneKey: laneKey,
      workflowContentFormat: contentFormat,
      workflowPageType: args.pageType,
      workflowSubtype: args.subtype,
      workflowStagePlan: args.workflowStagePlan,
      topicKey,
    });

    await insertWorkflowEvent(ctx, {
      taskId,
      projectId: args.projectId,
      stageKey: initialStage,
      eventType: "created",
      actorType: "system",
      actorId: args.requestedByUserId,
      actorName: "Workflow PM",
      summary: initialSummary,
      payload: {
        entryPoint: args.entryPoint,
        siteId: args.siteId,
        pageId: args.pageId,
        keywordId: args.keywordId,
        keywordClusterId: args.keywordClusterId,
        workflowStartDelayMs: startDelayMs,
        laneKey,
        contentFormat,
        pageType: args.pageType ?? null,
        subtype: args.subtype ?? null,
      },
    });

    await assignStageOwner(ctx, {
      taskId,
      projectId: args.projectId,
      stageKey: initialStage,
    });

    await insertHandoffEvent(ctx, {
      taskId,
      projectId: args.projectId,
      stageKey: initialStage,
      actorType: "system",
      actorId: args.requestedByUserId,
      actorName: "Workflow PM",
    });

    return {
      taskId,
      contentDocumentId: args.documentId,
      workflowStage: initialStage,
      laneKey,
      reused: false,
    };
  },
});

export const ensureStageOwner = mutation({
  args: {
    taskId: v.id("tasks"),
    stageKey: v.optional(stageValidator),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!isTopicTask(task)) {
      throw new Error("Task is not a topic workflow task.");
    }

    const stageKey = (args.stageKey ||
      task.workflowCurrentStageKey ||
      "research") as TopicStageKey;

    const assignment = await assignStageOwner(ctx, {
      taskId: task._id,
      projectId: task.projectId,
      stageKey,
    });

    return {
      ok: true,
      stageKey,
      blocked: Boolean(assignment?.blocked),
      queued: Boolean(assignment?.queued),
      queueReason: assignment?.queueReason ?? null,
      configuredSlotKey: assignment?.configuredSlotKey ?? null,
      configuredAgentName: assignment?.configuredAgentName ?? null,
      configuredWriterStatus:
        typeof assignment?.configuredWriterStatus === "string"
          ? assignment.configuredWriterStatus
          : null,
      repairAttempted: Boolean(assignment?.repairAttempted),
      repairOutcomeCode:
        typeof assignment?.repairOutcomeCode === "string"
          ? assignment.repairOutcomeCode
          : null,
      assignedAgentId: assignment?.assignedAgentId ?? null,
      assignedAgentName: assignment?.assignedAgentName ?? null,
    };
  },
});

export const backfillWorkflowLanes = mutation({
  args: {
    projectId: v.optional(v.number()),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const tasks =
      args.projectId !== undefined
        ? await ctx.db
            .query("tasks")
            .withIndex("by_project", (q) => q.eq("projectId", args.projectId as number))
            .collect()
        : await ctx.db.query("tasks").collect();

    let scanned = 0;
    let updated = 0;
    const sample: Array<{ taskId: string; laneKey: AgentLaneKey }> = [];

    for (const task of tasks) {
      if (task.workflowTemplateKey !== WORKFLOW_TEMPLATE_KEY) continue;
      scanned += 1;
      if (isAgentLaneKey(task.workflowLaneKey)) continue;
      const laneKey = resolveLaneFromTags(task.tags);
      if (!args.dryRun) {
        await ctx.db.patch(task._id, {
          workflowLaneKey: laneKey,
          tags: Array.from(new Set([...(task.tags || []), `lane:${laneKey}`])),
          updatedAt: Date.now(),
        });
      }
      updated += 1;
      if (sample.length < 20) {
        sample.push({ taskId: String(task._id), laneKey });
      }
    }

    return {
      ok: true,
      scanned,
      updated,
      dryRun: Boolean(args.dryRun),
      sample,
    };
  },
});

export const resetFromStage = mutation({
  args: {
    taskId: v.id("tasks"),
    fromStage: v.union(
      v.literal("research"),
      v.literal("outline_build"),
      v.literal("writing")
    ),
    actorType: v.union(v.literal("user"), v.literal("agent"), v.literal("system")),
    actorId: v.optional(v.string()),
    actorName: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!isTopicTask(task)) {
      throw new Error("Task is not a topic workflow task.");
    }

    const now = Date.now();
    const currentStage = (task.workflowCurrentStageKey || "research") as TopicStageKey;
    const existingApprovals = approvalsWithDefaults(task);
    const resetApprovals =
      args.fromStage === "writing"
        ? {
            outlineHuman: existingApprovals.outlineHuman,
            outlineSeo: existingApprovals.outlineSeo,
            seoFinal: false,
            outlineSkipped: existingApprovals.outlineSkipped,
          }
        : {
            outlineHuman: false,
            outlineSeo: false,
            seoFinal: false,
            outlineSkipped: false,
          };
    const resetDeliverables =
      args.fromStage === "writing"
        ? (task.deliverables || []).filter(
            (deliverable) => deliverable.type !== "preview_link"
          )
        : [];

    await ctx.db.patch(task._id, {
      workflowCurrentStageKey: args.fromStage,
      workflowStageStatus: "in_progress",
      workflowApprovals: resetApprovals,
      workflowUpdatedAt: now,
      workflowCompletedAt: undefined,
      status: stageToTaskStatus(args.fromStage),
      completedAt: undefined,
      deliverables: resetDeliverables,
      updatedAt: now,
    });

    const summary =
      args.note ||
      `Workflow reset from ${currentStage} to ${args.fromStage}. Downstream deliverables cleared.`;
    await insertWorkflowEvent(ctx, {
      taskId: task._id,
      projectId: task.projectId,
      stageKey: args.fromStage,
      eventType: "reset",
      fromStageKey: currentStage,
      toStageKey: args.fromStage,
      actorType: args.actorType,
      actorId: args.actorId,
      actorName: args.actorName,
      summary,
      payload: {
        resetFrom: args.fromStage,
        ownerChain: stageOwnerChains[args.fromStage],
      },
    });

    await assignStageOwner(ctx, {
      taskId: task._id,
      projectId: task.projectId,
      stageKey: args.fromStage,
    });

    await insertHandoffEvent(ctx, {
      taskId: task._id,
      projectId: task.projectId,
      stageKey: args.fromStage,
      fromStageKey: currentStage,
      actorType: "system",
      actorName: "Workflow PM",
    });

    return { ok: true };
  },
});

export const advanceStage = mutation({
  args: {
    taskId: v.id("tasks"),
    toStage: stageValidator,
    actorType: v.union(v.literal("user"), v.literal("agent"), v.literal("system")),
    actorId: v.optional(v.string()),
    actorName: v.optional(v.string()),
    note: v.optional(v.string()),
    skipOptionalOutlineReview: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!isTopicTask(task)) {
      throw new Error("Task is not a topic workflow task.");
    }

    const currentStage = (task.workflowCurrentStageKey || "research") as TopicStageKey;
    if (currentStage === args.toStage) {
      return { ok: true };
    }

    const flags = flagsWithDefaults(task);
    const approvals = approvalsWithDefaults(task);
    const plannedSequence = parsePlannedStageSequence(task);
    const plannedHasFinalReview = plannedSequence.includes("final_review");

    let allowed =
      stageTransitions[currentStage].includes(args.toStage) ||
      isAllowedTransitionByPlan(task, currentStage, args.toStage);

    // Legacy optional outline review skip path:
    if (
      !allowed &&
      currentStage === "outline_build" &&
      args.toStage === "writing" &&
      args.skipOptionalOutlineReview
    ) {
      if (!flags.outlineReviewOptional) {
        throw new Error("Outline review skip is disabled for this workflow.");
      }
      approvals.outlineSkipped = true;
      allowed = true;
    }

    if (!allowed) {
      throw new Error(`Illegal stage transition: ${currentStage} -> ${args.toStage}`);
    }

    if (args.toStage === "writing") {
      const outlineReady = await hasValidOutlineArtifact(ctx, task._id);
      if (!outlineReady) {
        throw new Error(
          "Outline artifact is missing or invalid. Writing cannot start before a valid outline is generated."
        );
      }
    }

    if (args.toStage === "human_review" && flags.seoReviewRequired && !approvals.seoFinal) {
      throw new Error("Final SEO approval is required before human review.");
    }

    if (
      args.toStage === "complete" &&
      flags.seoReviewRequired &&
      plannedHasFinalReview &&
      !approvals.seoFinal
    ) {
      throw new Error("Final SEO approval is required before completion.");
    }

    await transitionStage(ctx, {
      task,
      toStage: args.toStage,
      actorType: args.actorType,
      actorId: args.actorId,
      actorName: args.actorName,
      note: args.note,
      approvalsOverride: approvals,
    });

    return { ok: true };
  },
});

export const recordApproval = mutation({
  args: {
    taskId: v.id("tasks"),
    gate: v.union(
      v.literal("outline_human"),
      v.literal("outline_seo"),
      v.literal("seo_final")
    ),
    approved: v.boolean(),
    actorType: v.union(v.literal("user"), v.literal("agent")),
    actorId: v.optional(v.string()),
    actorName: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!isTopicTask(task)) {
      throw new Error("Task is not a topic workflow task.");
    }

    const now = Date.now();
    const approvals = approvalsWithDefaults(task);
    const currentStage = (task.workflowCurrentStageKey || "research") as TopicStageKey;
    const flags = flagsWithDefaults(task);

    if (args.gate === "outline_human") approvals.outlineHuman = args.approved;
    if (args.gate === "outline_seo") approvals.outlineSeo = args.approved;
    if (args.gate === "seo_final") approvals.seoFinal = args.approved;

    await ctx.db.patch(args.taskId, {
      workflowApprovals: approvals,
      workflowUpdatedAt: now,
      updatedAt: now,
    });

    const summary =
      args.note ||
      `Approval updated: ${args.gate} = ${args.approved ? "approved" : "rejected"}`;
    await insertWorkflowEvent(ctx, {
      taskId: args.taskId,
      projectId: task.projectId,
      stageKey: currentStage,
      eventType: "approval",
      actorType: args.actorType,
      actorId: args.actorId,
      actorName: args.actorName,
      summary,
      payload: { gate: args.gate, approved: args.approved },
    });

    let stageAdvanced = false;

    if (
      args.approved &&
      currentStage === "outline_review" &&
      approvals.outlineHuman &&
      approvals.outlineSeo
    ) {
      await transitionStage(ctx, {
        task,
        toStage: "writing",
        actorType: "system",
        actorName: "Workflow PM",
        note: "Outline approvals complete. Moving to writing.",
        approvalsOverride: approvals,
      });
      stageAdvanced = true;
    }

    if (
      args.approved &&
      args.gate === "seo_final" &&
      currentStage === "final_review" &&
      (!flags.seoReviewRequired || approvals.seoFinal)
    ) {
      const plannedNext = resolvePlannedNextStage(task, "final_review");
      const toStage: TopicStageKey = plannedNext || "human_review";
      await transitionStage(ctx, {
        task,
        toStage,
        actorType: "system",
        actorName: "Workflow PM",
        note: `Final SEO approval complete. Moving to ${toStage}.`,
        approvalsOverride: approvals,
      });
      stageAdvanced = true;
    }

    return { ok: true, stageAdvanced };
  },
});

export const recordStageArtifact = mutation({
  args: {
    taskId: v.id("tasks"),
    stageKey: stageValidator,
    summary: v.optional(v.string()),
    actorType: v.union(v.literal("user"), v.literal("agent"), v.literal("system")),
    actorId: v.optional(v.string()),
    actorName: v.optional(v.string()),
    artifact: v.optional(artifactValidator),
    deliverable: v.optional(deliverableValidator),
    payload: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!isTopicTask(task)) {
      throw new Error("Task is not a topic workflow task.");
    }

    const now = Date.now();
    const currentStage = (task.workflowCurrentStageKey || "research") as TopicStageKey;
    if (currentStage !== args.stageKey) {
      throw new Error(`Task is currently at ${currentStage}, cannot record artifact for ${args.stageKey}.`);
    }

    let savedDeliverable:
      | {
          id: string;
          type: string;
          title: string;
          url?: string;
          createdAt: number;
        }
      | null = null;

    if (args.deliverable) {
      const deliverables = task.deliverables || [];
      const deliverableId = args.deliverable.id || `wf_${args.stageKey}_${now}`;
      const exists = deliverables.some((d) => d.id === deliverableId);

      savedDeliverable = {
        id: deliverableId,
        type: args.deliverable.type,
        title: args.deliverable.title,
        url: args.deliverable.url,
        createdAt: now,
      };

      if (!exists) {
        await ctx.db.patch(args.taskId, {
          deliverables: [...deliverables, savedDeliverable],
          workflowUpdatedAt: now,
          updatedAt: now,
        });
      }
    }

    const summary = args.summary || `${args.stageKey} output recorded.`;

    await insertWorkflowEvent(ctx, {
      taskId: args.taskId,
      projectId: task.projectId,
      stageKey: args.stageKey as TopicStageKey,
      eventType: "stage_artifact",
      actorType: args.actorType,
      actorId: args.actorId,
      actorName: args.actorName,
      summary,
      payload: {
        artifact: args.artifact,
        deliverable: savedDeliverable,
        ...(args.payload ? { meta: args.payload } : {}),
      },
    });

    return { ok: true, deliverableId: savedDeliverable?.id ?? null };
  },
});

export const recordStageProgress = mutation({
  args: {
    taskId: v.id("tasks"),
    stageKey: stageValidator,
    summary: v.string(),
    actorType: v.union(v.literal("user"), v.literal("agent"), v.literal("system")),
    actorId: v.optional(v.string()),
    actorName: v.optional(v.string()),
    payload: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!isTopicTask(task)) {
      throw new Error("Task is not a topic workflow task.");
    }

    await insertWorkflowEvent(ctx, {
      taskId: args.taskId,
      projectId: task.projectId,
      stageKey: args.stageKey as TopicStageKey,
      eventType: "stage_progress",
      actorType: args.actorType,
      actorId: args.actorId,
      actorName: args.actorName,
      summary: args.summary,
      payload: args.payload,
    });

    return { ok: true };
  },
});

export const listWorkflowHistory = query({
  args: {
    taskId: v.id("tasks"),
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(args.limit ?? 50, 100));
    const cursorTs = args.cursor ? Number.parseInt(args.cursor, 10) : null;

    const events =
      cursorTs && Number.isFinite(cursorTs)
        ? await ctx.db
            .query("taskWorkflowEvents")
            .withIndex("by_task_time", (q) => q.eq("taskId", args.taskId).lt("createdAt", cursorTs))
            .order("desc")
            .take(limit)
        : await ctx.db
            .query("taskWorkflowEvents")
            .withIndex("by_task_time", (q) => q.eq("taskId", args.taskId))
            .order("desc")
            .take(limit);

    const nextCursor =
      events.length === limit ? String(events[events.length - 1].createdAt) : null;

    return { events, nextCursor };
  },
});

export const getWorkflowContext = query({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    const events = await ctx.db
      .query("taskWorkflowEvents")
      .withIndex("by_task_time", (q) => q.eq("taskId", args.taskId))
      .order("desc")
      .take(30);
    return { task, events };
  },
});

export const forceReleaseStaleAgent = mutation({
  args: {
    agentId: v.id("agents"),
    taskId: v.optional(v.id("tasks")),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const agent = await ctx.db.get(args.agentId);
    if (!agent || normalizeAgentStatus(agent.status) !== "WORKING") {
      return { released: false, reason: "not_working" };
    }
    if (args.taskId && agent.currentTaskId && agent.currentTaskId !== args.taskId) {
      return { released: false, reason: "different_task" };
    }
    await ctx.db.patch(args.agentId, {
      status: "IDLE",
      currentTaskId: undefined,
      updatedAt: Date.now(),
    });
    return { released: true, reason: args.reason || "force_release" };
  },
});
