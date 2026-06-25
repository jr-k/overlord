import { Hono } from "hono";
import { getWorkspaceSettings, setWorkspaceRoot } from "../settings.js";

const app = new Hono();

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

export default app;
