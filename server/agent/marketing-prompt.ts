import { db } from "../db/index.js";
import { marketingDrafts, marketingAssets } from "../db/schema.js";
import { eq, desc } from "drizzle-orm";

export function buildMarketingSystemPrompt(project: any): string {
  const parts: string[] = [];
  parts.push(
    "You are a marketing expert for solo developers and indie makers. You help with strategy, content creation (Reddit, LinkedIn, TikTok, Twitter/X, Threads, Bluesky, Instagram, YouTube, Steam, Product Hunt), launches, organic growth, positioning, and ASO/SEO. You know Chris Zukowski's best practices (howtomarketagame.com), build-in-public patterns, LinkedIn hooks, short Reddit formats, and TikTok scripts. Be direct, pragmatic, and focused on concrete actions."
  );
  parts.push("\nMatch the language of the user's message. When in French, use proper accents.");

  if (project) {
    const ctx: string[] = [];
    ctx.push(`\n[PROJECT CONTEXT]`);
    ctx.push(`Project: ${project.name}`);
    if (project.tagline) ctx.push(`Tagline: ${project.tagline}`);
    if (project.shortDescription) ctx.push(`Description: ${project.shortDescription}`);
    if (project.longDescription) ctx.push(`Long description: ${project.longDescription}`);
    if (project.links) ctx.push(`Links:\n${project.links}`);
    if (project.summary) ctx.push(`Auto-summary: ${project.summary}`);

    try {
      const recentDrafts = db
        .select()
        .from(marketingDrafts)
        .where(eq(marketingDrafts.projectId, project.id))
        .orderBy(desc(marketingDrafts.updatedAt))
        .limit(5)
        .all();
      if (recentDrafts.length > 0) {
        ctx.push(`\nRecent drafts (last 5):`);
        for (const d of recentDrafts) {
          ctx.push(`- [${d.platform}${d.status === "published" ? " published" : ""}] ${d.content.slice(0, 150).replace(/\n/g, " ")}...`);
        }
      }
    } catch {}

    try {
      const assets = db
        .select()
        .from(marketingAssets)
        .where(eq(marketingAssets.projectId, project.id))
        .all();
      if (assets.length > 0) {
        ctx.push(`\nAssets available: ${assets.map((a: any) => `${a.name} (${a.type})`).join(", ")}`);
      }
    } catch {}

    ctx.push(`[/PROJECT CONTEXT]`);
    parts.push(ctx.join("\n"));
  }

  return parts.join("\n");
}
