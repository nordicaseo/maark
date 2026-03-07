import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

export const list = query({
  args: {
    projectId: v.optional(v.number()),
    status: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(args.limit ?? 300, 1000));

    if (args.projectId !== undefined) {
      return await ctx.db
        .query("tasks")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId!))
        .order("desc")
        .take(limit);
    }
    if (args.status) {
      return await ctx.db
        .query("tasks")
        .withIndex("by_status", (q) => q.eq("status", args.status!))
        .order("desc")
        .take(limit);
    }
    // Never return global task data by default.
    return [];
  },
});

export const getByDocument = query({
  args: {
    documentId: v.number(),
    projectId: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_document", (q) => q.eq("documentId", args.documentId))
      .collect();
    if (args.projectId === undefined) return tasks;
    return tasks.filter((task) => task.projectId === args.projectId);
  },
});

export const get = query({
  args: {
    id: v.id("tasks"),
    projectId: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.id);
    if (!task) return null;
    if (args.projectId !== undefined && task.projectId !== args.projectId) return null;
    return task;
  },
});

export const create = mutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    type: v.string(),
    status: v.string(),
    priority: v.string(),
    position: v.optional(v.number()),
    documentId: v.optional(v.number()),
    projectId: v.optional(v.number()),
    skillId: v.optional(v.number()),
    dueDate: v.optional(v.number()),
    tags: v.optional(v.array(v.string())),
    assigneeId: v.optional(v.string()),
    workflowTemplateKey: v.optional(v.string()),
    workflowCurrentStageKey: v.optional(v.string()),
    workflowStageStatus: v.optional(v.string()),
    workflowFlags: v.optional(v.object({
      outlineReviewOptional: v.optional(v.boolean()),
      seoReviewRequired: v.optional(v.boolean()),
    })),
    workflowApprovals: v.optional(v.object({
      outlineHuman: v.optional(v.boolean()),
      outlineSeo: v.optional(v.boolean()),
      seoFinal: v.optional(v.boolean()),
      outlineSkipped: v.optional(v.boolean()),
    })),
    workflowStartedAt: v.optional(v.number()),
    workflowUpdatedAt: v.optional(v.number()),
    workflowCompletedAt: v.optional(v.number()),
    workflowLastEventAt: v.optional(v.number()),
    workflowLastEventText: v.optional(v.string()),
    workflowRunNotBeforeAt: v.optional(v.number()),
    workflowLaneKey: v.optional(v.string()),
    topicKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const id = await ctx.db.insert("tasks", {
      ...args,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("activities", {
      type: "task_created",
      taskId: id,
      description: `Task "${args.title}" created`,
      projectId: args.projectId,
      createdAt: Date.now(),
    });

    return id;
  },
});

export const update = mutation({
  args: {
    id: v.id("tasks"),
    expectedProjectId: v.optional(v.number()),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    type: v.optional(v.string()),
    status: v.optional(v.string()),
    priority: v.optional(v.string()),
    position: v.optional(v.number()),
    documentId: v.optional(v.number()),
    projectId: v.optional(v.number()),
    skillId: v.optional(v.number()),
    assignedAgentId: v.optional(v.id("agents")),
    assigneeId: v.optional(v.string()),
    dueDate: v.optional(v.number()),
    tags: v.optional(v.array(v.string())),
    deliverables: v.optional(v.array(v.object({
      id: v.string(),
      type: v.string(),
      title: v.string(),
      url: v.optional(v.string()),
      createdAt: v.number(),
    }))),
    commentCount: v.optional(v.number()),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    workflowTemplateKey: v.optional(v.string()),
    workflowCurrentStageKey: v.optional(v.string()),
    workflowStageStatus: v.optional(v.string()),
    workflowFlags: v.optional(v.object({
      outlineReviewOptional: v.optional(v.boolean()),
      seoReviewRequired: v.optional(v.boolean()),
    })),
    workflowApprovals: v.optional(v.object({
      outlineHuman: v.optional(v.boolean()),
      outlineSeo: v.optional(v.boolean()),
      seoFinal: v.optional(v.boolean()),
      outlineSkipped: v.optional(v.boolean()),
    })),
    workflowStartedAt: v.optional(v.number()),
    workflowUpdatedAt: v.optional(v.number()),
    workflowCompletedAt: v.optional(v.number()),
    workflowLastEventAt: v.optional(v.number()),
    workflowLastEventText: v.optional(v.string()),
    workflowRunNotBeforeAt: v.optional(v.number()),
    workflowLaneKey: v.optional(v.string()),
    topicKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, expectedProjectId, ...updates } = args;
    const existing = await ctx.db.get(id);
    if (!existing) return;
    if (expectedProjectId !== undefined && existing.projectId !== expectedProjectId) {
      throw new Error("Task project scope mismatch.");
    }
    await ctx.db.patch(id, { ...updates, updatedAt: Date.now() });
  },
});

export const updateStatus = mutation({
  args: {
    id: v.id("tasks"),
    status: v.string(),
    expectedProjectId: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.id);
    if (!task) return;
    if (args.expectedProjectId !== undefined && task.projectId !== args.expectedProjectId) {
      throw new Error("Task project scope mismatch.");
    }

    const updates: Record<string, unknown> = {
      status: args.status,
      updatedAt: Date.now(),
    };
    if (args.status === "IN_PROGRESS") {
      updates.startedAt = Date.now();
    }
    if (args.status === "COMPLETED") {
      updates.completedAt = Date.now();
    }
    await ctx.db.patch(args.id, updates);

    await ctx.db.insert("activities", {
      type: "status_changed",
      taskId: args.id,
      description: `Status changed from ${task?.status || "unknown"} to ${args.status}`,
      projectId: task?.projectId,
      metadata: { from: task?.status, to: args.status },
      createdAt: Date.now(),
    });
  },
});

/**
 * Update task status from a sync source (e.g. Drizzle document status change).
 * Identical logic to `updateStatus` but exists as a separate function so
 * client code can distinguish user-initiated vs sync-initiated status changes
 * and avoid triggering reverse sync loops.
 */
export const updateStatusFromSync = mutation({
  args: {
    id: v.id("tasks"),
    status: v.string(),
    expectedProjectId: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.id);
    if (!task || task.status === args.status) return; // Already matches — no-op
    if (args.expectedProjectId !== undefined && task.projectId !== args.expectedProjectId) {
      throw new Error("Task project scope mismatch.");
    }

    const updates: Record<string, unknown> = {
      status: args.status,
      updatedAt: Date.now(),
    };
    if (args.status === "IN_PROGRESS") {
      updates.startedAt = Date.now();
    }
    if (args.status === "COMPLETED") {
      updates.completedAt = Date.now();
    }
    await ctx.db.patch(args.id, updates);
  },
});

export const remove = mutation({
  args: {
    id: v.id("tasks"),
    expectedProjectId: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.id);
    if (!task) return;
    if (args.expectedProjectId !== undefined && task.projectId !== args.expectedProjectId) {
      throw new Error("Task project scope mismatch.");
    }
    await ctx.db.delete(args.id);
  },
});
