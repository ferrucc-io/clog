# zod-telemetry

**Turn runtime data into Zod types.**

You have `any` everywhere. You suspect the shape, but you're not sure. You add a schema, it throws in production, you roll back, and nothing improves.

`zod-telemetry` flips this: validation failures are **silently collected** instead of thrown. A local server accumulates the real data your app sees. A dashboard infers the actual Zod schema from those samples so you can paste it straight into your codebase.

```
┌─────────────────────┐      POST /report      ┌─────────────────────┐
│   Your frontend      │ ─────────────────────► │  zod-telemetry      │
│  (client wraps zod)  │    localhost:3456       │  server             │
│  never throws ✓      │                         │  (collects samples) │
└─────────────────────┘                         └──────────┬──────────┘
                                                            │
                                                     localhost:3456
                                                            │
                                                 ┌──────────▼──────────┐
                                                 │   Dashboard UI       │
                                                 │  infers Zod schemas  │
                                                 │  from real data ✓    │
                                                 └─────────────────────┘
```

---

## Packages

| Package | Description |
|---|---|
| [`@zod-telemetry/client`](./packages/client) | Drop-in Zod wrapper for your frontend/backend |
| [`@zod-telemetry/server`](./packages/server) | Local server + dashboard |

---

## Quick start

### 1. Start the server

```bash
npx @zod-telemetry/server
# Dashboard → http://localhost:3456
```

Or install globally:

```bash
npm install -g @zod-telemetry/server
zod-telemetry
```

### 2. Wrap your schemas

```bash
npm install @zod-telemetry/client zod
```

```ts
// telemetry.ts  (create once, import everywhere)
import { createZodTelemetry } from "@zod-telemetry/client";

export const { schema } = createZodTelemetry({
  endpoint: "http://localhost:3456",
});
```

```ts
// api.ts
import { z } from "zod";
import { schema } from "./telemetry";

// Define the shape you *think* the API returns.
// Even if it's wrong, your app won't throw.
export const UserSchema = schema("User", z.object({
  id: z.number(),
  name: z.string(),
  role: z.enum(["admin", "user"]),
}));

// Use it exactly like normal Zod – just never throws.
const user = UserSchema.parse(apiResponse);
```

### 3. Open the dashboard

Browse to **http://localhost:3456**. For every schema that received invalid data you'll see:

- How many times validation failed, and when
- The actual payloads that didn't match
- An **inferred Zod schema** derived from those payloads
- A ready-to-copy usage snippet

---

## Client API

### `createZodTelemetry(options)`

```ts
import { createZodTelemetry } from "@zod-telemetry/client";

const { schema, flush } = createZodTelemetry({
  endpoint: "http://localhost:3456",  // required

  // Optional – reduce HTTP overhead for high-frequency schemas
  batch: true,          // default: false
  batchSize: 20,        // flush when queue reaches this size
  batchInterval: 2000,  // flush every N ms

  // Log a warning to the console on each failure (dev mode)
  verbose: true,        // default: false
});
```

### `schema(name, zodSchema)`

Wraps any Zod schema. Returns an object with two methods:

| Method | Behaviour |
|---|---|
| `.parse(data)` | Like `z.parse()` but **never throws**. Returns raw input on failure. |
| `.safeParse(data)` | Like `z.safeParse()` but **always returns `{ success: true }`**. |

Both methods report the failure + actual data to the server whenever validation fails.

### `flush()`

Force-flush the batch queue. Useful before a page unload:

```ts
window.addEventListener("beforeunload", () => { flush(); });
```

---

## Server API

The server also exposes a REST API you can query directly:

| Method | Path | Description |
|---|---|---|
| `POST` | `/report` | Report a single validation failure |
| `POST` | `/report/batch` | Report an array of failures |
| `GET` | `/api/schemas` | List all schemas with stats |
| `GET` | `/api/schemas/:name` | Get details + inferred schema for one schema |
| `DELETE` | `/api/schemas/:name` | Clear data for one schema |
| `DELETE` | `/api/schemas` | Clear all data |

Data is persisted to `~/.zod-telemetry/telemetry.json`.

### Custom port

```bash
zod-telemetry --port=4000
```

---

## How type inference works

When you open the dashboard, `zod-telemetry` analyses every sample it collected for a schema and synthesises the narrowest Zod type that would accept all of them:

- **Primitives** → `z.string()`, `z.number()`, `z.boolean()`
- **Mixed primitives** → `z.union([z.string(), z.number()])`
- **Objects** → `z.object({...})` with recursive field inference
- **Fields missing in some samples** → `.optional()`
- **null values** → `.nullable()`
- **Arrays** → `z.array(inferredElementType)`

The result is a complete Zod schema you can copy and paste, replacing the `z.any()` (or approximate schema) you started with.

---

## Example workflow

```
1.  You have: const data: any = await fetchUser(id)

2.  Wrap it:
      const UserSchema = schema("User", z.object({
        id: z.number(),
        name: z.string(),
      }));
      const user = UserSchema.parse(data);
      // app keeps running even if shape is wrong

3.  Let it collect data overnight / through your test suite.

4.  Open http://localhost:3456 → click "User"

5.  Copy the inferred schema:
      z.object({
        id: z.number().int(),
        name: z.string(),
        email: z.string().optional(),
        role: z.string(),
        createdAt: z.string(),
        metadata: z.object({ plan: z.string() }).optional(),
      })

6.  Replace your schema with this, remove zod-telemetry wrapping, ship. ✓
```

---

## Development

```bash
# Install deps (requires pnpm)
pnpm install

# Build both packages
pnpm build

# Run the server in watch mode
pnpm dev
```
