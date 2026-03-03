import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // ── Tasks ──────────────────────────────────────────────────────
  tasks: defineTable({
    // Core
    title: v.string(),
    description: v.optional(v.string()),
    type: v.string(), // "content", "review", "research", "edit"

    // Status & Priority
    status: v.string(), // "BACKLOG", "PENDING", "IN_PROGRESS", "IN_REVIEW", "COMPLETED"
    priority: v.string(), // "LOW", "MEDIUM", "HIGH", "URGENT"
    position: v.optional(v.number()), // for kanban ordering

    // Assignment
    assignedAgentId: v.optional(v.id("agents")),
    assigneeId: v.optional(v.string()), // human assignee

    // Drizzle-side references (stored as plain numbers/strings)
    documentId: v.optional(v.number()), // -> Drizzle documents.id
    projectId: v.optional(v.number()), // -> Drizzle projects.id
    skillId: v.optional(v.number()), // -> Drizzle skills.id

    // Deliverables
    deliverables: v.optional(v.array(v.object({
      id: v.string(),
      type: v.string(), // "article", "preview_link", "report"
      title: v.string(),
      url: v.optional(v.string()),
      createdAt: v.number(),
    }))),

    // Time
    dueDate: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),

    // Tags & Metadata
    tags: v.optional(v.array(v.string())),
    commentCount: v.optional(v.number()),
  })
    .index("by_status", ["status"])
    .index("by_project", ["projectId"])
    .index("by_priority", ["priority"])
    .index("by_document", ["documentId"]),

  // ── Agents ─────────────────────────────────────────────────────
  agents: defineTable({
    name: v.string(),
    role: v.string(), // "writer", "editor", "researcher"
    status: v.string(), // "ONLINE", "WORKING", "IDLE", "OFFLINE"
    specialization: v.optional(v.string()),
    skills: v.optional(v.array(v.string())),
    currentTaskId: v.optional(v.id("tasks")),
    tasksCompleted: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_status", ["status"]),
});
