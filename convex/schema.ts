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
    status: v.string(), // "BACKLOG", "PENDING", "IN_PROGRESS", "IN_REVIEW", "ACCEPTED", "COMPLETED"
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

    // Topic Workflow v1
    workflowTemplateKey: v.optional(v.string()), // e.g. "topic_production_v1"
    workflowCurrentStageKey: v.optional(v.string()),
    workflowStageStatus: v.optional(v.string()), // "pending" | "in_progress" | "blocked" | "complete"
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
  })
    .index("by_status", ["status"])
    .index("by_project", ["projectId"])
    .index("by_priority", ["priority"])
    .index("by_document", ["documentId"])
    .index("by_project_workflow_stage", ["projectId", "workflowCurrentStageKey"]),

  // ── Task Workflow Events ───────────────────────────────────────
  taskWorkflowEvents: defineTable({
    taskId: v.id("tasks"),
    projectId: v.optional(v.number()),
    stageKey: v.string(),
    eventType: v.string(), // "created" | "transition" | "approval" | "discussion" | "handoff"
    fromStageKey: v.optional(v.string()),
    toStageKey: v.optional(v.string()),
    actorType: v.string(), // "user" | "agent" | "system"
    actorId: v.optional(v.string()),
    actorName: v.optional(v.string()),
    summary: v.string(),
    payload: v.optional(v.any()),
    createdAt: v.number(),
  })
    .index("by_task_time", ["taskId", "createdAt"])
    .index("by_project_time", ["projectId", "createdAt"]),

  // ── Agents ─────────────────────────────────────────────────────
  agents: defineTable({
    name: v.string(),
    role: v.string(), // "writer", "editor", "researcher"
    status: v.string(), // "ONLINE", "WORKING", "IDLE", "OFFLINE"
    projectId: v.optional(v.number()),
    isDedicated: v.optional(v.boolean()),
    capacityWeight: v.optional(v.number()),
    slotKey: v.optional(v.string()),
    laneKey: v.optional(v.string()),
    laneProfileKey: v.optional(v.string()),
    assignmentHealth: v.optional(v.any()),
    specialization: v.optional(v.string()),
    skills: v.optional(v.array(v.string())),
    currentTaskId: v.optional(v.id("tasks")),
    tasksCompleted: v.optional(v.number()),
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
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_status", ["status"])
    .index("by_project", ["projectId"])
    .index("by_project_role", ["projectId", "role"])
    .index("by_project_role_lane", ["projectId", "role", "laneKey"])
    .index("by_slot", ["slotKey"]),

  // ── Activities ────────────────────────────────────────────────────
  activities: defineTable({
    type: v.string(),       // "task_created", "status_changed", "agent_executed", "comment_added", "task_assigned", "message"
    taskId: v.optional(v.id("tasks")),
    agentId: v.optional(v.id("agents")),
    userId: v.optional(v.string()),     // Drizzle user ID
    userName: v.optional(v.string()),   // Denormalized for display
    description: v.string(),
    metadata: v.optional(v.any()),
    projectId: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_task", ["taskId"])
    .index("by_created", ["createdAt"]),

  // ── Messages ──────────────────────────────────────────────────────
  messages: defineTable({
    taskId: v.optional(v.id("tasks")),
    projectId: v.optional(v.number()),
    authorType: v.string(),               // "user" or "agent"
    authorId: v.string(),                 // Drizzle user ID or Convex agent ID string
    authorName: v.string(),
    content: v.string(),
    createdAt: v.number(),
  })
    .index("by_task", ["taskId"])
    .index("by_project", ["projectId"])
    .index("by_created", ["createdAt"]),
});
