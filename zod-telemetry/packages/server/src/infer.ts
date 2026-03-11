/**
 * Infers a Zod schema string from a collection of sample values.
 * The goal is to produce the narrowest schema that is satisfied by all samples.
 */

type JsonPrimitive = string | number | boolean | null;
type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue }
  | undefined;

/** Returns a deduplicated array. */
function unique<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

/** Escape a key for use in a z.object() literal. */
function formatKey(key: string): string {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
}

/** Indent every line of a multi-line string by `n` spaces. */
function indent(s: string, n: number): string {
  const pad = " ".repeat(n);
  return s
    .split("\n")
    .map((line) => pad + line)
    .join("\n");
}

// ---------------------------------------------------------------------------
// Core inference
// ---------------------------------------------------------------------------

/**
 * Infer a Zod schema expression string for a single value.
 * This is used per-sample; results are then merged across samples.
 */
function inferSingle(value: JsonValue): string {
  if (value === null) return "z.null()";
  if (value === undefined) return "z.undefined()";

  switch (typeof value) {
    case "string":
      return "z.string()";
    case "number":
      return Number.isInteger(value) ? "z.number().int()" : "z.number()";
    case "boolean":
      return "z.boolean()";
    case "object":
      if (Array.isArray(value)) {
        return inferArray(value);
      }
      return inferObject(value as Record<string, JsonValue>);
    default:
      return "z.unknown()";
  }
}

function inferArray(samples: JsonValue[]): string {
  if (samples.length === 0) return "z.array(z.unknown())";
  const elementType = inferFromSamples(samples);
  return `z.array(${elementType})`;
}

function inferObject(obj: Record<string, JsonValue>): string {
  const keys = Object.keys(obj);
  if (keys.length === 0) return "z.object({})";

  const fields = keys.map((key) => {
    const fieldType = inferSingle(obj[key]);
    return `${formatKey(key)}: ${fieldType}`;
  });

  if (fields.length <= 3 && !fields.some((f) => f.includes("\n"))) {
    // Inline for short objects
    return `z.object({ ${fields.join(", ")} })`;
  }

  return `z.object({\n${fields.map((f) => indent(f, 2)).join(",\n")},\n})`;
}

// ---------------------------------------------------------------------------
// Merging types across multiple samples
// ---------------------------------------------------------------------------

/**
 * Merge-infer a Zod type from an array of samples.
 * Handles nullability, optionality, and field-level merging for objects.
 */
export function inferFromSamples(samples: JsonValue[]): string {
  if (samples.length === 0) return "z.unknown()";

  const hasNull = samples.some((s) => s === null);
  const hasUndefined = samples.some((s) => s === undefined);

  const defined = samples.filter((s) => s !== null && s !== undefined);

  if (defined.length === 0) {
    if (hasNull && hasUndefined) return "z.null().optional()";
    if (hasNull) return "z.null()";
    return "z.undefined()";
  }

  const baseType = mergeDefinedSamples(defined);

  let result = baseType;
  if (hasNull) result = `${result}.nullable()`;
  if (hasUndefined) result = `${result}.optional()`;

  return result;
}

function mergeDefinedSamples(samples: JsonValue[]): string {
  // Separate samples by broad category
  const primitives = samples.filter(
    (s) => s !== null && s !== undefined && typeof s !== "object"
  );
  const objects = samples.filter(
    (s) => s !== null && !Array.isArray(s) && typeof s === "object"
  ) as Record<string, JsonValue>[];
  const arrays = samples.filter((s) => Array.isArray(s)) as JsonValue[][];

  const parts: string[] = [];

  if (primitives.length > 0) {
    const primitiveTypes = unique(primitives.map(inferSingle));
    if (primitiveTypes.length === 1) {
      parts.push(primitiveTypes[0]);
    } else {
      // Coerce number variants: if both int and float appeared, use z.number()
      const deduped = deduplicateNumberTypes(primitiveTypes);
      if (deduped.length === 1) parts.push(deduped[0]);
      else parts.push(`z.union([${deduped.join(", ")}])`);
    }
  }

  if (objects.length > 0) {
    parts.push(mergeObjects(objects));
  }

  if (arrays.length > 0) {
    const allElements = arrays.flat();
    parts.push(`z.array(${inferFromSamples(allElements)})`);
  }

  if (parts.length === 0) return "z.unknown()";
  if (parts.length === 1) return parts[0];
  return `z.union([${parts.join(", ")}])`;
}

function deduplicateNumberTypes(types: string[]): string[] {
  if (types.includes("z.number()") && types.includes("z.number().int()")) {
    return types.filter((t) => t !== "z.number().int()");
  }
  return types;
}

/**
 * Merge multiple object samples into a single z.object() expression.
 * Fields present in only some samples become .optional().
 */
function mergeObjects(objects: Record<string, JsonValue>[]): string {
  // Collect every key seen across all samples
  const allKeys = unique(objects.flatMap((o) => Object.keys(o)));

  if (allKeys.length === 0) return "z.object({})";

  const fields = allKeys.map((key) => {
    const values = objects.map((o) => o[key]); // undefined when absent
    const alwaysPresent = objects.every(
      (o) => key in o && o[key] !== undefined
    );

    // Only pass non-undefined values to inferFromSamples for the base type,
    // but mark optional if the field was absent in some samples.
    const presentValues = values.filter((v) => v !== undefined) as JsonValue[];
    let fieldType = inferFromSamples(presentValues);

    if (!alwaysPresent) {
      // Append .optional() if it isn't already there
      if (!fieldType.endsWith(".optional()")) {
        fieldType = `${fieldType}.optional()`;
      }
    }

    return `${formatKey(key)}: ${fieldType}`;
  });

  if (fields.length <= 3 && !fields.some((f) => f.includes("\n"))) {
    return `z.object({ ${fields.join(", ")} })`;
  }

  return `z.object({\n${fields.map((f) => indent(f, 2)).join(",\n")},\n})`;
}
