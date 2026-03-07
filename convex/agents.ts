import { v } from "convex/values";
import { query, mutation } from "./_generated/server";

function normalizeAgentStatus(status: string): "ONLINE" | "WORKING" | "IDLE" | "OFFLINE" {
  const normalized = String(status || "")
    .trim()
    .toUpperCase();
  if (normalized === "ONLINE") return "ONLINE";
  if (normalized === "WORKING") return "WORKING";
  if (normalized === "IDLE") return "IDLE";
  return "OFFLINE";
}

export const list = query({
  args: {
    status: v.optional(v.string()),
    projectId: v.optional(v.number()),
    role: v.optional(v.string()),
    laneKey: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(args.limit ?? 200, 1000));
    if (args.status && args.projectId === undefined && !args.role) {
      const status = normalizeAgentStatus(args.status);
      return await ctx.db
        .query("agents")
        .withIndex("by_status", (q) => q.eq("status", status))
        .take(limit);
    }
    const rows = await ctx.db.query("agents").take(limit * 4);
    const filtered = rows.filter((agent) => {
      if (args.status && normalizeAgentStatus(agent.status) !== normalizeAgentStatus(args.status)) {
        return false;
      }
      if (args.projectId !== undefined && agent.projectId !== args.projectId) return false;
      if (args.role && agent.role.toLowerCase() !== args.role.toLowerCase()) return false;
      if (args.laneKey && String(agent.laneKey || "").toLowerCase() !== args.laneKey.toLowerCase()) {
        return false;
      }
      return true;
    });
    return filtered.slice(0, limit);
  },
});

export const getOnline = query({
  handler: async (ctx) => {
    return await ctx.db
      .query("agents")
      .withIndex("by_status", (q) => q.eq("status", "ONLINE"))
      .collect();
  },
});

export const get = query({
  args: { id: v.id("agents") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const register = mutation({
  args: {
    name: v.string(),
    role: v.string(),
    projectId: v.optional(v.number()),
    isDedicated: v.optional(v.boolean()),
    capacityWeight: v.optional(v.number()),
    slotKey: v.optional(v.string()),
    laneKey: v.optional(v.string()),
    laneProfileKey: v.optional(v.string()),
    assignmentHealth: v.optional(v.any()),
    specialization: v.optional(v.string()),
    skills: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("agents", {
      ...args,
      status: "ONLINE",
      tasksCompleted: 0,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateStatus = mutation({
  args: {
    id: v.id("agents"),
    status: v.string(),
    currentTaskId: v.optional(v.id("tasks")),
  },
  handler: async (ctx, args) => {
    const normalizedStatus = normalizeAgentStatus(args.status);
    const updates: Record<string, unknown> = {
      status: normalizedStatus,
      updatedAt: Date.now(),
    };
    if (args.currentTaskId !== undefined) {
      updates.currentTaskId = args.currentTaskId;
    }
    if (normalizedStatus === "ONLINE" || normalizedStatus === "IDLE" || normalizedStatus === "OFFLINE") {
      updates.currentTaskId = undefined;
    }
    await ctx.db.patch(args.id, updates);
  },
});

export const updatePersonaAndModels = mutation({
  args: {
    id: v.id("agents"),
    personaProfile: v.optional(v.object({
      soul: v.optional(v.string()),
      heart: v.optional(v.string()),
      personality: v.optional(v.string()),
      collaborationStyle: v.optional(v.string()),
      reviewStyle: v.optional(v.string()),
    })),
    modelOverrides: v.optional(
      v.record(
        v.string(),
        v.object({
          provider: v.optional(v.string()),
          modelId: v.optional(v.string()),
          temperature: v.optional(v.number()),
        })
      )
    ),
  },
  handler: async (ctx, args) => {
    const { id, personaProfile, modelOverrides } = args;
    await ctx.db.patch(id, {
      personaProfile,
      modelOverrides,
      updatedAt: Date.now(),
    });
  },
});

export const updateRuntime = mutation({
  args: {
    id: v.id("agents"),
    projectId: v.optional(v.union(v.number(), v.null())),
    isDedicated: v.optional(v.boolean()),
    capacityWeight: v.optional(v.number()),
    slotKey: v.optional(v.union(v.string(), v.null())),
    laneKey: v.optional(v.union(v.string(), v.null())),
    laneProfileKey: v.optional(v.union(v.string(), v.null())),
    assignmentHealth: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const updates: Record<string, unknown> = {
      updatedAt: Date.now(),
    };
    if (args.projectId !== undefined) updates.projectId = args.projectId ?? undefined;
    if (args.isDedicated !== undefined) updates.isDedicated = args.isDedicated;
    if (args.capacityWeight !== undefined) updates.capacityWeight = args.capacityWeight;
    if (args.slotKey !== undefined) updates.slotKey = args.slotKey ?? undefined;
    if (args.laneKey !== undefined) updates.laneKey = args.laneKey ?? undefined;
    if (args.laneProfileKey !== undefined) updates.laneProfileKey = args.laneProfileKey ?? undefined;
    if (args.assignmentHealth !== undefined) updates.assignmentHealth = args.assignmentHealth;
    await ctx.db.patch(args.id, updates);
  },
});

export const remove = mutation({
  args: { id: v.id("agents") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});
