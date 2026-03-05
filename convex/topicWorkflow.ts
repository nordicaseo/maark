import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

const WORKFLOW_TEMPLATE_KEY = "topic_production_v1";

type TopicStageKey =
  | "research"
  | "outline_build"
  | "outline_review"
  | "prewrite_context"
  | "writing"
  | "final_review"
  | "complete";

const stageValidator = v.union(
  v.literal("research"),
  v.literal("outline_build"),
  v.literal("outline_review"),
  v.literal("prewrite_context"),
  v.literal("writing"),
  v.literal("final_review"),
  v.literal("complete")
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

const stageTransitions: Record<TopicStageKey, TopicStageKey[]> = {
  research: ["outline_build"],
  outline_build: ["outline_review"],
  outline_review: ["prewrite_context"],
  prewrite_context: ["writing"],
  writing: ["final_review"],
  final_review: ["complete"],
  complete: [],
};

const stageOwnerChains: Record<TopicStageKey, string[]> = {
  research: ["researcher", "seo", "lead"],
  outline_build: ["outliner", "content", "lead"],
  outline_review: ["human", "seo-reviewer"],
  prewrite_context: ["project-manager"],
  writing: ["writer", "content", "lead"],
  final_review: ["seo-reviewer", "seo", "lead"],
  complete: ["project-manager"],
};

const roleAliases: Record<string, string[]> = {
  researcher: ["researcher", "seo", "editor", "writer"],
  outliner: ["outliner", "editor", "writer", "content"],
  writer: ["writer", "content", "editor"],
  "seo-reviewer": ["seo-reviewer", "seo", "editor"],
  "project-manager": ["project-manager", "lead", "editor"],
  seo: ["seo", "seo-reviewer", "editor"],
  content: ["content", "writer", "editor"],
  lead: ["lead", "project-manager", "editor", "seo-reviewer"],
};

function stageOwnerSummary(stage: TopicStageKey): string {
  const chain = stageOwnerChains[stage] || ["lead"];
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

function isTopicTask(task: Doc<"tasks"> | null | undefined): task is Doc<"tasks"> {
  return Boolean(task && task.workflowTemplateKey === WORKFLOW_TEMPLATE_KEY);
}

function stageToTaskStatus(stage: TopicStageKey): string {
  switch (stage) {
    case "research":
    case "outline_build":
    case "outline_review":
    case "prewrite_context":
    case "writing":
      return "IN_PROGRESS";
    case "final_review":
      return "IN_REVIEW";
    case "complete":
      return "COMPLETED";
    default:
      return "BACKLOG";
  }
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

async function resolveStageOwnerAgent(
  ctx: MutationCtx,
  stage: TopicStageKey
): Promise<{ agent: Doc<"agents">; requestedRole: string; matchedRole: string } | null> {
  const chain = stageOwnerChains[stage] || [];
  if (chain.length === 0) return null;

  const onlineAgents = await ctx.db
    .query("agents")
    .withIndex("by_status", (q) => q.eq("status", "ONLINE"))
    .collect();
  const idleAgents = await ctx.db
    .query("agents")
    .withIndex("by_status", (q) => q.eq("status", "IDLE"))
    .collect();

  for (const requestedRole of chain) {
    if (requestedRole === "human") continue;

    const candidates = normalizedRoleCandidates(requestedRole);
    const findByRole = (agents: Doc<"agents">[]) =>
      agents.find((agent) => candidates.includes(agent.role.toLowerCase()));

    const online = findByRole(onlineAgents);
    if (online) {
      return { agent: online, requestedRole, matchedRole: online.role };
    }

    const idle = findByRole(idleAgents);
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
    payload: args.payload,
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
  }
) {
  const assignment = await resolveStageOwnerAgent(ctx, args.stageKey);
  if (!assignment) return null;

  await ctx.db.patch(args.taskId, {
    assignedAgentId: assignment.agent._id,
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
    },
  });

  return assignment;
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
    workflowStageStatus: args.toStage === "complete" ? "complete" : "in_progress",
    workflowUpdatedAt: now,
    updatedAt: now,
    status: stageToTaskStatus(args.toStage),
    workflowApprovals: approvals,
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
    options: v.optional(
      v.object({
        outlineReviewOptional: v.optional(v.boolean()),
        seoReviewRequired: v.optional(v.boolean()),
      })
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const topicKey = normalizeTopicKey(args.topic);

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
        reused: true,
      };
    }

    const outlineReviewOptional = args.options?.outlineReviewOptional ?? true;
    const seoReviewRequired = args.options?.seoReviewRequired ?? true;
    const initialStage: TopicStageKey = "research";
    const initialSummary = `Topic workflow created from ${args.entryPoint}: ${args.topic}`;

    const taskId = await ctx.db.insert("tasks", {
      title: args.topic,
      description: `Topic workflow (${args.entryPoint})`,
      type: "content",
      status: stageToTaskStatus(initialStage),
      priority: "MEDIUM",
      documentId: args.documentId,
      projectId: args.projectId,
      skillId: args.skillId,
      tags: ["topic", "workflow", args.entryPoint],
      createdAt: now,
      updatedAt: now,
      startedAt: now,
      workflowTemplateKey: WORKFLOW_TEMPLATE_KEY,
      workflowCurrentStageKey: initialStage,
      workflowStageStatus: "in_progress",
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
      reused: false,
    };
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

    let allowed = stageTransitions[currentStage].includes(args.toStage);

    // Optional outline review skip path:
    if (
      !allowed &&
      currentStage === "outline_build" &&
      args.toStage === "prewrite_context" &&
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
      const outlineGateSatisfied =
        approvals.outlineSkipped ||
        !flags.outlineReviewOptional ||
        (approvals.outlineHuman && approvals.outlineSeo);
      if (!outlineGateSatisfied) {
        throw new Error("Outline approvals must be completed before writing.");
      }
    }

    if (args.toStage === "complete" && flags.seoReviewRequired && !approvals.seoFinal) {
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
        toStage: "prewrite_context",
        actorType: "system",
        actorName: "Workflow PM",
        note: "Outline approvals complete. Moving to prewrite context.",
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
      await transitionStage(ctx, {
        task,
        toStage: "complete",
        actorType: "system",
        actorName: "Workflow PM",
        note: "Final SEO approval complete. Marking task complete.",
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
