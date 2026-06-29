import { Hono } from "hono";
import { existsSync, readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { getWorkspaceSettings, setWorkspaceRoot } from "../settings.js";

const app = new Hono();
const GITHUB_URL = "https://github.com/poptocrack/overlord";

function readPackageVersion() {
  const candidates = [
    resolve(process.cwd(), "package.json"),
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json"),
  ];

  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) {
        return JSON.parse(readFileSync(candidate, "utf8")).version ?? "0.0.0";
      }
    } catch {
      // Try the next candidate.
    }
  }

  return process.env.npm_package_version ?? "0.0.0";
}

app.get("/workspace", (c) => {
  return c.json(getWorkspaceSettings());
});

app.patch("/workspace", async (c) => {
  const body = await c.req.json().catch(() => ({}));

  try {
    return c.json(setWorkspaceRoot(body.path ?? ""));
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Invalid workspace path" }, 400);
  }
});

app.get("/about", (c) => {
  return c.json({
    version: readPackageVersion(),
    githubUrl: GITHUB_URL,
  });
});

export default app;
