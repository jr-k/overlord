import { db } from "../db/index.js";
import { marketingDrafts, marketingAssets } from "../db/schema.js";
import { eq, desc } from "drizzle-orm";

export function buildMarketingSystemPrompt(project: any): string {
  const parts: string[] = [];
  parts.push(
    "Tu es un expert marketing pour solo devs et indie makers. Tu aides sur la strategie, la creation de contenu (Reddit, LinkedIn, TikTok, Twitter/X, Threads, Bluesky, Instagram, YouTube, Steam, Product Hunt), les launches, la croissance organique, le positioning, l'ASO/SEO. Tu connais les best practices de Chris Zukowski (howtomarketagame.com), les patterns de build-in-public, les hooks LinkedIn, les formats courts Reddit, les scripts TikTok. Tu es direct, pragmatique, et axe actions concretes."
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
