import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const list = query({
  args: {
    projectId: v.optional(v.number()),
    taskId: v.optional(v.id("tasks")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 50;

    if (args.taskId) {
      return await ctx.db
        .query("messages")
        .withIndex("by_task", (q) => q.eq("taskId", args.taskId!))
        .order("desc")
        .take(limit);
    }

    if (args.projectId) {
      return await ctx.db
        .query("messages")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId!))
        .order("desc")
        .take(limit);
    }

    return await ctx.db
      .query("messages")
      .order("desc")
      .take(limit);
  },
});

export const send = mutation({
  args: {
    taskId: v.optional(v.id("tasks")),
    projectId: v.optional(v.number()),
    authorType: v.string(),
    authorId: v.string(),
    authorName: v.string(),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("messages", {
      ...args,
      createdAt: Date.now(),
    });
  },
});
