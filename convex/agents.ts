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
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(args.limit ?? 200, 1000));
    if (args.status) {
      const status = normalizeAgentStatus(args.status);
      return await ctx.db
        .query("agents")
        .withIndex("by_status", (q) => q.eq("status", status))
        .take(limit);
    }
    return await ctx.db.query("agents").take(limit);
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
