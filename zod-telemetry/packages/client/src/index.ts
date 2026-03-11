import type { ZodTypeAny, z, ZodError } from "zod";

export interface TelemetryClientOptions {
  /** URL of the zod-telemetry server, e.g. "http://localhost:3456" */
  endpoint: string;
  /**
   * Whether to batch reports before sending.
   * Reduces network overhead for high-frequency validations.
   * @default false
   */
  batch?: boolean;
  /**
   * Max number of events to accumulate before flushing (only when batch=true).
   * @default 20
   */
  batchSize?: number;
  /**
   * Milliseconds between batch flushes (only when batch=true).
   * @default 2000
   */
  batchInterval?: number;
  /**
   * Whether to log a warning to the console when a validation fails.
   * Useful during development.
   * @default false
   */
  verbose?: boolean;
}

export interface ValidationFailure {
  schemaName: string;
  timestamp: string;
  input: unknown;
  errors: ZodError["errors"];
}

export interface TelemetrySchema<T extends ZodTypeAny> {
  /**
   * Parses the input using the underlying Zod schema.
   * Unlike zod's parse(), this NEVER throws. If the input fails validation,
   * the failure is reported to the telemetry server and the raw input is returned.
   */
  parse(data: unknown): z.infer<T>;

  /**
   * Same as zod's safeParse(), but always returns success=true.
   * The input is reported to the telemetry server if validation fails.
   * The returned `data` is always the raw input (never transformed).
   */
  safeParse(data: unknown): { success: true; data: z.infer<T> };
}

export interface TelemetryClient {
  /**
   * Wraps a Zod schema with telemetry. The returned schema behaves like a
   * regular Zod schema, but validation failures are silently reported to the
   * server instead of throwing.
   *
   * @param name  A stable, human-readable name for this schema (used as the
   *              key in the telemetry dashboard).
   * @param zodSchema  Any Zod schema (z.object, z.string, z.union, etc.)
   */
  schema<T extends ZodTypeAny>(name: string, zodSchema: T): TelemetrySchema<T>;

  /**
   * Immediately flush any buffered failures (only relevant when batch=true).
   */
  flush(): Promise<void>;
}

function sendReport(endpoint: string, failure: ValidationFailure): void {
  // Use fetch if available (modern browsers and Node 18+), otherwise silently skip.
  if (typeof fetch === "undefined") return;

  fetch(`${endpoint}/report`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(failure),
    // keepalive lets the request outlive the page in browser contexts.
    keepalive: true,
  }).catch(() => {
    // Intentionally swallowed – telemetry must never affect the host app.
  });
}

function sendBatch(
  endpoint: string,
  failures: ValidationFailure[]
): Promise<void> {
  if (typeof fetch === "undefined" || failures.length === 0)
    return Promise.resolve();

  return fetch(`${endpoint}/report/batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(failures),
    keepalive: true,
  })
    .then(() => undefined)
    .catch(() => undefined);
}

/**
 * Creates a telemetry client that wraps Zod schemas to report validation
 * failures to a central server without ever throwing or interrupting the
 * host application.
 *
 * @example
 * ```ts
 * import { z } from "zod";
 * import { createZodTelemetry } from "@zod-telemetry/client";
 *
 * const { schema } = createZodTelemetry({ endpoint: "http://localhost:3456" });
 *
 * // Define once, use everywhere
 * export const UserSchema = schema("User", z.object({
 *   id: z.number(),
 *   name: z.string(),
 *   role: z.enum(["admin", "user"]),
 * }));
 *
 * // Won't throw even if `apiResponse` has unexpected shape
 * const user = UserSchema.parse(apiResponse);
 * ```
 */
export function createZodTelemetry(
  options: TelemetryClientOptions
): TelemetryClient {
  const {
    endpoint,
    batch = false,
    batchSize = 20,
    batchInterval = 2000,
    verbose = false,
  } = options;

  let queue: ValidationFailure[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleFlush() {
    if (flushTimer !== null) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flush();
    }, batchInterval);
  }

  async function flush(): Promise<void> {
    if (queue.length === 0) return;
    const toSend = queue.splice(0);
    await sendBatch(endpoint, toSend);
  }

  function report(failure: ValidationFailure): void {
    if (verbose) {
      console.warn(
        `[zod-telemetry] Validation failed for schema "${failure.schemaName}"`,
        failure.errors
      );
    }

    if (batch) {
      queue.push(failure);
      if (queue.length >= batchSize) {
        if (flushTimer !== null) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
        flush();
      } else {
        scheduleFlush();
      }
    } else {
      sendReport(endpoint, failure);
    }
  }

  function schema<T extends ZodTypeAny>(
    name: string,
    zodSchema: T
  ): TelemetrySchema<T> {
    return {
      parse(data: unknown): z.infer<T> {
        const result = zodSchema.safeParse(data);
        if (!result.success) {
          report({
            schemaName: name,
            timestamp: new Date().toISOString(),
            input: data,
            errors: result.error.errors,
          });
          // Return raw input as-is so the host app keeps running.
          return data as z.infer<T>;
        }
        return result.data;
      },

      safeParse(data: unknown): { success: true; data: z.infer<T> } {
        const result = zodSchema.safeParse(data);
        if (!result.success) {
          report({
            schemaName: name,
            timestamp: new Date().toISOString(),
            input: data,
            errors: result.error.errors,
          });
        }
        // Always report success so callers never branch on failures.
        return { success: true, data: (result.success ? result.data : data) as z.infer<T> };
      },
    };
  }

  return { schema, flush };
}
