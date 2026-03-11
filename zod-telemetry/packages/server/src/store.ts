import fs from "fs";
import path from "path";
import { inferFromSamples } from "./infer.js";

export interface StoredFailure {
  id: string;
  schemaName: string;
  timestamp: string;
  input: unknown;
  errors: Array<{
    path: (string | number)[];
    message: string;
    code: string;
  }>;
}

export interface SchemaStats {
  name: string;
  totalFailures: number;
  firstSeen: string;
  lastSeen: string;
  /** Up to MAX_SAMPLES most-recent failures */
  samples: StoredFailure[];
  /** Zod schema expression inferred from the sample inputs */
  inferredSchema: string;
}

const MAX_SAMPLES = 100;

export class TelemetryStore {
  /** schemaName -> ordered list of failures (newest last) */
  private failures = new Map<string, StoredFailure[]>();

  private persistPath: string | null;
  private dirty = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(persistPath: string | null = null) {
    this.persistPath = persistPath;
    if (persistPath) {
      this.load(persistPath);
    }
  }

  // -------------------------------------------------------------------------
  // Write
  // -------------------------------------------------------------------------

  addFailure(failure: Omit<StoredFailure, "id">): void {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const entry: StoredFailure = { id, ...failure };

    const list = this.failures.get(failure.schemaName) ?? [];
    list.push(entry);

    // Cap to MAX_SAMPLES (drop oldest)
    if (list.length > MAX_SAMPLES) {
      list.splice(0, list.length - MAX_SAMPLES);
    }

    this.failures.set(failure.schemaName, list);
    this.scheduleSave();
  }

  addBatch(failures: Omit<StoredFailure, "id">[]): void {
    for (const f of failures) this.addFailure(f);
  }

  clearSchema(name: string): void {
    this.failures.delete(name);
    this.scheduleSave();
  }

  clearAll(): void {
    this.failures.clear();
    this.scheduleSave();
  }

  // -------------------------------------------------------------------------
  // Read
  // -------------------------------------------------------------------------

  listSchemas(): SchemaStats[] {
    return [...this.failures.entries()].map(([name, list]) =>
      this.buildStats(name, list)
    );
  }

  getSchema(name: string): SchemaStats | null {
    const list = this.failures.get(name);
    if (!list) return null;
    return this.buildStats(name, list);
  }

  private buildStats(name: string, list: StoredFailure[]): SchemaStats {
    const inputs = list.map((f) => f.input);
    return {
      name,
      totalFailures: list.length,
      firstSeen: list[0]?.timestamp ?? "",
      lastSeen: list[list.length - 1]?.timestamp ?? "",
      samples: list.slice(-20), // last 20 for the UI
      inferredSchema: inferFromSamples(inputs as never),
    };
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  private scheduleSave(): void {
    this.dirty = true;
    if (this.saveTimer !== null) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.save();
    }, 1000);
  }

  private save(): void {
    if (!this.persistPath || !this.dirty) return;
    this.dirty = false;
    try {
      const data: Record<string, StoredFailure[]> = {};
      for (const [k, v] of this.failures) data[k] = v;
      fs.mkdirSync(path.dirname(this.persistPath), { recursive: true });
      fs.writeFileSync(this.persistPath, JSON.stringify(data, null, 2));
    } catch {
      // Best-effort – never crash on save failure
    }
  }

  private load(filePath: string): void {
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      const data = JSON.parse(raw) as Record<string, StoredFailure[]>;
      for (const [k, v] of Object.entries(data)) {
        if (Array.isArray(v)) this.failures.set(k, v);
      }
    } catch {
      // File may not exist yet; that's fine
    }
  }
}
