import { mutation } from "./_generated/server";

/**
 * Idempotent seed mutation — registers the three default AI agents.
 * Run once via: npx convex run seed:seedAgents
 */
export const seedAgents = mutation({
  handler: async (ctx) => {
    // Check if agents already exist
    const existing = await ctx.db.query("agents").collect();
    if (existing.length > 0) {
      return { message: `Skipped — ${existing.length} agent(s) already exist.` };
    }

    const now = Date.now();

    const agents = [
      {
        name: "Atlas",
        role: "writer",
        specialization: "Long-form SEO content",
        skills: ["SEO writing", "keyword research", "content structure", "blog posts"],
        status: "ONLINE",
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
        tasksCompleted: 0,
        createdAt: now,
        updatedAt: now,
      },
    ];

    const ids = [];
    for (const agent of agents) {
      const id = await ctx.db.insert("agents", agent);
      ids.push(id);
    }

    return { message: `Seeded ${ids.length} agents.`, ids };
  },
});
