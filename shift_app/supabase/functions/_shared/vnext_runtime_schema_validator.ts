// Deterministic validator for the JSON-Schema subset used by Checkpoint 1.
// Error objects contain paths/codes only: never model values or provider data.

export type RuntimeValidationStageVNext = "geometry" | "evidence";

export class RuntimeSchemaValidationErrorVNext extends Error {
  readonly code = "RUNTIME_SCHEMA_VALIDATION_FAILED";

  constructor(
    public readonly stage: RuntimeValidationStageVNext,
    public readonly issueCode: string,
    public readonly path: string,
  ) {
    super(`${stage} runtime validation failed: ${issueCode} at ${path}`);
    this.name = "RuntimeSchemaValidationErrorVNext";
  }
}

function fail(stage: RuntimeValidationStageVNext, issueCode: string, path: string): never {
  throw new RuntimeSchemaValidationErrorVNext(stage, issueCode, path);
}

function matchesType(value: unknown, type: string): boolean {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  return typeof value === type;
}

export function assertMatchesCheckpointSchemaVNext(
  value: unknown,
  schemaValue: unknown,
  stage: RuntimeValidationStageVNext,
  path = "$",
): void {
  const schema = schemaValue as Record<string, unknown>;
  if (Array.isArray(schema.anyOf)) {
    for (const branch of schema.anyOf) {
      try {
        assertMatchesCheckpointSchemaVNext(value, branch, stage, path);
        return;
      } catch (error) {
        if (!(error instanceof RuntimeSchemaValidationErrorVNext)) throw error;
      }
    }
    fail(stage, "NO_ANY_OF_BRANCH_MATCHED", path);
  }

  const allowedTypes = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (schema.type !== undefined && !allowedTypes.some((type) => matchesType(value, String(type)))) {
    fail(stage, "INVALID_TYPE", path);
  }

  if (Array.isArray(schema.enum) && !schema.enum.some((item) => Object.is(item, value))) {
    fail(stage, "INVALID_ENUM", path);
  }

  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) fail(stage, "BELOW_MINIMUM", path);
    if (typeof schema.maximum === "number" && value > schema.maximum) fail(stage, "ABOVE_MAXIMUM", path);
    if (typeof schema.exclusiveMaximum === "number" && value >= schema.exclusiveMaximum) {
      fail(stage, "AT_OR_ABOVE_EXCLUSIVE_MAXIMUM", path);
    }
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) fail(stage, "TOO_FEW_ITEMS", path);
    if (schema.items) {
      value.forEach((item, index) =>
        assertMatchesCheckpointSchemaVNext(item, schema.items, stage, `${path}[${index}]`)
      );
    }
    return;
  }

  if (value !== null && typeof value === "object") {
    const object = value as Record<string, unknown>;
    const properties = (schema.properties ?? {}) as Record<string, unknown>;
    const required = (schema.required ?? []) as string[];
    for (const key of required) {
      if (!Object.prototype.hasOwnProperty.call(object, key)) fail(stage, "MISSING_REQUIRED_PROPERTY", `${path}.${key}`);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(object)) {
        if (!Object.prototype.hasOwnProperty.call(properties, key)) fail(stage, "ADDITIONAL_PROPERTY", `${path}.${key}`);
      }
    }
    for (const [key, childSchema] of Object.entries(properties)) {
      if (Object.prototype.hasOwnProperty.call(object, key)) {
        assertMatchesCheckpointSchemaVNext(object[key], childSchema, stage, `${path}.${key}`);
      }
    }
  }
}

const SAFE_ID_PATTERN_VNEXT = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/;

export function assertSafeIdVNext(
  value: unknown,
  stage: RuntimeValidationStageVNext,
  path: string,
): asserts value is string {
  if (typeof value !== "string" || !SAFE_ID_PATTERN_VNEXT.test(value)) {
    fail(stage, "INVALID_ID_SHAPE", path);
  }
}
