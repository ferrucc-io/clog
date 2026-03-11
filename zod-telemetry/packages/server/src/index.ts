import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import fs from "fs";
import path from "path";
import os from "os";
import { TelemetryStore } from "./store.js";

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const portArg = args.find((a) => a.startsWith("--port="));
const PORT = portArg ? parseInt(portArg.split("=")[1], 10) : 3456;
const dataDir = path.join(os.homedir(), ".zod-telemetry");
const persistPath = path.join(dataDir, "telemetry.json");

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const store = new TelemetryStore(persistPath);

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const app = new Hono();

app.use("*", cors({ origin: "*" }));
app.use("*", logger());

// ---- Telemetry ingestion ---------------------------------------------------

app.post("/report", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body.schemaName !== "string") {
    return c.json({ error: "Invalid payload" }, 400);
  }
  store.addFailure({
    schemaName: body.schemaName,
    timestamp: body.timestamp ?? new Date().toISOString(),
    input: body.input,
    errors: body.errors ?? [],
  });
  return c.json({ ok: true });
});

app.post("/report/batch", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!Array.isArray(body)) {
    return c.json({ error: "Expected an array" }, 400);
  }
  store.addBatch(
    body
      .filter((b) => b && typeof b.schemaName === "string")
      .map((b) => ({
        schemaName: b.schemaName,
        timestamp: b.timestamp ?? new Date().toISOString(),
        input: b.input,
        errors: b.errors ?? [],
      }))
  );
  return c.json({ ok: true });
});

// ---- API -------------------------------------------------------------------

app.get("/api/schemas", (c) => {
  const schemas = store.listSchemas().map((s) => ({
    name: s.name,
    totalFailures: s.totalFailures,
    firstSeen: s.firstSeen,
    lastSeen: s.lastSeen,
    inferredSchema: s.inferredSchema,
  }));
  return c.json(schemas);
});

app.get("/api/schemas/:name", (c) => {
  const name = decodeURIComponent(c.req.param("name"));
  const schema = store.getSchema(name);
  if (!schema) return c.json({ error: "Not found" }, 404);
  return c.json(schema);
});

app.delete("/api/schemas/:name", (c) => {
  const name = decodeURIComponent(c.req.param("name"));
  store.clearSchema(name);
  return c.json({ ok: true });
});

app.delete("/api/schemas", (c) => {
  store.clearAll();
  return c.json({ ok: true });
});

// ---- Web UI ----------------------------------------------------------------

app.get("/", (c) => {
  const publicDir = path.join(__dirname, "..", "public");
  const indexPath = path.join(publicDir, "index.html");
  try {
    const html = fs.readFileSync(indexPath, "utf8");
    return c.html(html);
  } catch {
    return c.html("<h1>UI not found – run a build first</h1>", 500);
  }
});

// ---- Start -----------------------------------------------------------------

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`
╔══════════════════════════════════════════════════════╗
║          zod-telemetry server running                ║
║                                                      ║
║  Dashboard  → http://localhost:${PORT}                  ║
║  API        → http://localhost:${PORT}/api/schemas       ║
║  Data       → ${persistPath.padEnd(35)}  ║
╚══════════════════════════════════════════════════════╝
`);
});
