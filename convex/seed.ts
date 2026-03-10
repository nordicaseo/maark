import { mutation } from "./_generated/server";

/**
 * Idempotent seed mutation — ensures default workflow agents exist.
 * Run once via: npx convex run seed:seedAgents
 */
export const seedAgents = mutation({
  handler: async (ctx) => {
    // Check existing agents by role so the seed can add missing roles safely.
    const existing = await ctx.db.query("agents").collect();
    const existingRoles = new Set(existing.map((a) => a.role));

    const now = Date.now();

    const agents = [
      {
        name: "Atlas",
        role: "writer",
        specialization: "Long-form SEO content",
        skills: ["SEO writing", "keyword research", "content structure", "blog posts"],
        status: "ONLINE",
        isDedicated: false,
        assignmentHealth: { routable: false, legacyGlobal: true },
        tasksCompleted: 0,
        createdAt: now,
        updatedAt: now,
      },
      {
        name: "Nova",
        role: "editor",
        specialization: "Content review & polish",
        skills: ["grammar", "tone adjustment", "readability", "fact-checking"],
        status: "ONLINE",
        isDedicated: false,
        assignmentHealth: { routable: false, legacyGlobal: true },
        tasksCompleted: 0,
        createdAt: now,
        updatedAt: now,
      },
      {
        name: "Sage",
        role: "researcher",
        specialization: "Research & data analysis",
        skills: ["topic research", "competitor analysis", "data synthesis", "citations"],
        status: "ONLINE",
        isDedicated: false,
        assignmentHealth: { routable: false, legacyGlobal: true },
        tasksCompleted: 0,
        createdAt: now,
        updatedAt: now,
      },
      {
        name: "Maple",
        role: "outliner",
        specialization: "Structured outlines and narrative flow",
        skills: ["outline design", "content architecture", "section planning"],
        status: "ONLINE",
        isDedicated: false,
        assignmentHealth: { routable: false, legacyGlobal: true },
        tasksCompleted: 0,
        createdAt: now,
        updatedAt: now,
      },
      {
        name: "Orion",
        role: "seo-reviewer",
        specialization: "SEO and on-page optimization reviews",
        skills: ["SERP alignment", "on-page SEO", "metadata reviews", "internal linking"],
        status: "ONLINE",
        isDedicated: false,
        assignmentHealth: { routable: false, legacyGlobal: true },
        tasksCompleted: 0,
        createdAt: now,
        updatedAt: now,
      },
      {
        name: "Maark",
        role: "project-manager",
        specialization: "System orchestration and handoffs",
        skills: ["workflow planning", "handoffs", "risk checks"],
        status: "ONLINE",
        isDedicated: false,
        assignmentHealth: { routable: false, legacyGlobal: true },
        tasksCompleted: 0,
        createdAt: now,
        updatedAt: now,
      },
      {
        name: "Helix",
        role: "seo",
        specialization: "SEO strategy and keyword alignment",
        skills: ["keyword strategy", "entity coverage", "ranking factors"],
        status: "ONLINE",
        isDedicated: false,
        assignmentHealth: { routable: false, legacyGlobal: true },
        tasksCompleted: 0,
        createdAt: now,
        updatedAt: now,
      },
      {
        name: "Lumen",
        role: "content",
        specialization: "General content production support",
        skills: ["content planning", "drafting", "editing support"],
        status: "ONLINE",
        isDedicated: false,
        assignmentHealth: { routable: false, legacyGlobal: true },
        tasksCompleted: 0,
        createdAt: now,
        updatedAt: now,
      },
      {
        name: "Astra",
        role: "lead",
        specialization: "Editorial lead and escalation fallback",
        skills: ["quality oversight", "final decisions", "workflow escalation"],
        status: "ONLINE",
        isDedicated: false,
        assignmentHealth: { routable: false, legacyGlobal: true },
        tasksCompleted: 0,
        createdAt: now,
        updatedAt: now,
      },
    ];

    const ids = [];
    const healedStatuses: string[] = [];
    for (const agent of agents) {
      if (existingRoles.has(agent.role)) continue;
      const id = await ctx.db.insert("agents", agent);
      ids.push(id);
    }

    const criticalRoles = new Set(agents.map((agent) => agent.role.toLowerCase()));
    const allAgents = await ctx.db.query("agents").collect();
    for (const agent of allAgents) {
      if (!criticalRoles.has(agent.role.toLowerCase())) continue;

      if (agent.status === "OFFLINE") {
        await ctx.db.patch(agent._id, {
          status: "ONLINE",
          currentTaskId: undefined,
          isDedicated: agent.isDedicated ?? false,
          assignmentHealth: {
            ...((agent.assignmentHealth as Record<string, unknown> | undefined) || {}),
            routable: false,
            legacyGlobal: true,
          },
          updatedAt: now,
        });
        healedStatuses.push(`${agent.role}:offline->online`);
        continue;
      }

      if (agent.status === "WORKING" && !agent.currentTaskId) {
        await ctx.db.patch(agent._id, {
          status: "IDLE",
          currentTaskId: undefined,
          isDedicated: agent.isDedicated ?? false,
          assignmentHealth: {
            ...((agent.assignmentHealth as Record<string, unknown> | undefined) || {}),
            routable: false,
            legacyGlobal: true,
          },
          updatedAt: now,
        });
        healedStatuses.push(`${agent.role}:working->idle`);
        continue;
      }

      if (agent.status === "WORKING" && agent.currentTaskId) {
        const activeTask = await ctx.db.get(agent.currentTaskId);
        const staleWorking =
          !activeTask ||
          activeTask.status === "COMPLETED" ||
          activeTask.workflowCurrentStageKey === "complete";
        if (staleWorking) {
          await ctx.db.patch(agent._id, {
            status: "IDLE",
            currentTaskId: undefined,
            isDedicated: agent.isDedicated ?? false,
            assignmentHealth: {
              ...((agent.assignmentHealth as Record<string, unknown> | undefined) || {}),
              routable: false,
              legacyGlobal: true,
            },
            updatedAt: now,
          });
          healedStatuses.push(`${agent.role}:stale-working->idle`);
        }
      }
    }

    if (ids.length === 0 && healedStatuses.length === 0) {
      return {
        message: `No new agents needed — ${existing.length} existing agent(s) already cover seeded roles.`,
        ids,
        healed: healedStatuses,
      };
    }

    return {
      message: `Seeded ${ids.length} missing agent(s), healed ${healedStatuses.length} stale status record(s).`,
      ids,
      healed: healedStatuses,
    };
  },
});
