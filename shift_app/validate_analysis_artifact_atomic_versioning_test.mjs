// Static and deterministic local verification for migration 0008 and the
// Checkpoint 1 atomic persistence call. No database or network is contacted.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const buildDirectory = "./build";
const workspacePayloadModule = resolve(buildDirectory, "vnext_checkpoint1_payload.js");
const workspaceModuleAvailable = existsSync(workspacePayloadModule);
let temporaryBuildDirectory = null;
let bootstrapDiagnosticWritten = false;

function safeTestHookPath(path) {
  const resolvedPath = resolve(path);
  const temporaryRoot = resolve(tmpdir()) + sep;
  if (!resolvedPath.startsWith(temporaryRoot)) {
    throw new Error("test hook paths must remain under the temporary directory");
  }
  return resolvedPath;
}

try {
let selectedPayloadModule = workspacePayloadModule;
if (!workspaceModuleAvailable) {
  temporaryBuildDirectory = mkdtempSync(join(tmpdir(), "shift-atomic-build-"));
  try {
    execFileSync(
      "tsc",
      ["-p", "tsconfig.checkpoint1.json", "--outDir", temporaryBuildDirectory],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (error) {
    if (error?.stdout?.length) process.stderr.write(error.stdout);
    if (error?.stderr?.length) process.stderr.write(error.stderr);
    if (!error?.stdout?.length && !error?.stderr?.length) {
      console.error("ATOMIC_TEST_BOOTSTRAP_FAILED: tsc is unavailable or could not start");
    }
    bootstrapDiagnosticWritten = true;
    throw error;
  }
  selectedPayloadModule = join(temporaryBuildDirectory, "vnext_checkpoint1_payload.js");

  // Test-only synchronization and failure hooks. They are inert unless the
  // explicit opt-in flag is set, accept control files under /tmp only, and
  // never write to stdout or to the workspace build directory.
  if (process.env.SHIFT_ATOMIC_TEST_HOOKS === "1") {
    const hookMode = process.env.SHIFT_ATOMIC_TEST_HOOK_MODE;
    if (hookMode === "pause-after-compile") {
      const readyFile = safeTestHookPath(process.env.SHIFT_ATOMIC_TEST_READY_FILE ?? "");
      const continueFile = safeTestHookPath(process.env.SHIFT_ATOMIC_TEST_CONTINUE_FILE ?? "");
      writeFileSync(readyFile, temporaryBuildDirectory, { encoding: "utf8", flag: "wx" });
      const waitBuffer = new Int32Array(new SharedArrayBuffer(4));
      const deadline = Date.now() + 30000;
      while (!existsSync(continueFile)) {
        if (Date.now() >= deadline) throw new Error("test hook synchronization timed out");
        Atomics.wait(waitBuffer, 0, 0, 25);
      }
    } else if (hookMode === "fail-import") {
      selectedPayloadModule = join(temporaryBuildDirectory, "missing-test-hook.js");
    }
  }
}

const {
  buildVnextCheckpoint1PayloadInput,
  isCanonicalUuid,
  withVnextCheckpoint1Attempt,
} = await import(pathToFileURL(selectedPayloadModule).href);

const migration = readFileSync("./0008_analysis_artifact_atomic_versioning.sql", "utf8");
const handlerPath = "supabase/functions/analyze-sketch-vnext-checkpoint1/index.ts";
const handler = readFileSync("./" + handlerPath, "utf8");
const blockers = readFileSync("./OPEN_BLOCKERS.md", "utf8");
const executableMigration = migration.replace(/--.*$/gm, "");
const EXPECTED_INDEX_NAME = "analysis_artifacts_vnext_checkpoint1_version_uidx";
const LEGACY_WRITERS = [
  "supabase/functions/analyze-sketch-v2-scope/index.ts",
  "supabase/functions/analyze-sketch-v2-page-dimensions/index.ts",
  "supabase/functions/analyze-sketch-v2-measurements/index.ts",
  "supabase/functions/analyze-sketch-v2-envelope/index.ts",
  "supabase/functions/analyze-sketch-v2-envelope-topology/index.ts",
  "supabase/functions/analyze-sketch-v2-canonical-topology/index.ts",
];

let assertionsPassed = 0;
let assertionsFailed = 0;

function check(label, condition) {
  if (condition) assertionsPassed++;
  else {
    assertionsFailed++;
    console.error("ASSERTION_FAILED: " + label);
  }
}

function count(sourceText, pattern) {
  return (sourceText.match(pattern) || []).length;
}

check(
  "bootstrap imports an existing generated payload module",
  existsSync(selectedPayloadModule),
);
check(
  "bootstrap selects either the workspace module or an isolated temporary directory",
  workspaceModuleAvailable
    ? temporaryBuildDirectory === null && selectedPayloadModule === workspacePayloadModule
    : temporaryBuildDirectory !== null &&
      dirname(selectedPayloadModule) === temporaryBuildDirectory &&
      temporaryBuildDirectory.startsWith(resolve(tmpdir()) + sep),
);
check(
  "bootstrap cleanup target is never the workspace build directory",
  temporaryBuildDirectory === null ||
    resolve(temporaryBuildDirectory) !== resolve(buildDirectory),
);

const EXPECTED_CANONICAL_PREDICATE = "(stage = 'vnext_checkpoint1'::text)";
const EXPECTED_SQL_PREDICATE_LITERAL = "'(stage = ''vnext_checkpoint1''::text)'";
const EXPECTED_LOCK_TIMEOUT_SQL = "set local lock_timeout = '2s';";
const EXPECTED_STATEMENT_TIMEOUT_SQL = "set local statement_timeout = '30s';";
const EXPECTED_TIMEOUT_BLOCK =
  "begin;\n" + EXPECTED_LOCK_TIMEOUT_SQL + "\n" + EXPECTED_STATEMENT_TIMEOUT_SQL;

function replaceOnce(sourceText, expected, replacement) {
  const position = sourceText.indexOf(expected);
  if (position < 0) throw new Error("mutation target not found");
  return sourceText.slice(0, position) + replacement + sourceText.slice(position + expected.length);
}

function hasExactInlineTimeoutPolicy(sourceText) {
  const executableLines = sourceText
    .split(/\r?\n/)
    .map((line) => line.replace(/--.*$/, "").trim())
    .filter(Boolean);
  const beginPosition = executableLines.indexOf("begin;");
  const lockPosition = executableLines.indexOf(
    "lock table public.analysis_artifacts in share row exclusive mode;",
  );
  const lockTimeoutAssignments = executableLines.filter((line) =>
    /^set(?:\s+local)?\s+lock_timeout\s*=/i.test(line)
  );
  const statementTimeoutAssignments = executableLines.filter((line) =>
    /^set(?:\s+local)?\s+statement_timeout\s*=/i.test(line)
  );

  return beginPosition >= 0 &&
    lockPosition > beginPosition + 2 &&
    executableLines[beginPosition + 1] === EXPECTED_LOCK_TIMEOUT_SQL &&
    executableLines[beginPosition + 2] === EXPECTED_STATEMENT_TIMEOUT_SQL &&
    lockTimeoutAssignments.length === 1 &&
    statementTimeoutAssignments.length === 1;
}

function migrationContractViolations(sourceText) {
  const executable = sourceText.replace(/--.*$/gm, "");
  const violations = [];
  const exactCreate = /create unique index analysis_artifacts_vnext_checkpoint1_version_uidx\s+on public\.analysis_artifacts \(job_id, stage, version\)\s+where stage = 'vnext_checkpoint1';/g;
  const exactPredicateComparison =
    "or v_index_predicate is distinct from\n        " + EXPECTED_SQL_PREDICATE_LITERAL;

  if (!hasExactInlineTimeoutPolicy(sourceText)) violations.push("INLINE_TIMEOUT_POLICY");
  if (count(sourceText, exactCreate) !== 1) violations.push("PARTIAL_INDEX_DEFINITION");
  if (count(executable, /create\s+unique\s+index/gi) !== 1) violations.push("UNIQUE_INDEX_COUNT");
  if (/create\s+unique\s+index[\s\S]*?on\s+public\.analysis_artifacts\s*\(job_id,\s*stage,\s*version\)\s*;/i.test(executable)) {
    violations.push("GLOBAL_UNIQUE_INDEX");
  }
  if (!sourceText.includes(exactPredicateComparison) || count(sourceText, /v_index_predicate is distinct from/g) !== 1) {
    violations.push("PREDICATE_COMPARISON");
  }
  if (/regexp_replace|v_normalized_predicate/.test(sourceText)) violations.push("LOSSY_PREDICATE_NORMALIZATION");
  if (!/v_index_columns is distinct from array\['job_id', 'stage', 'version'\]::text\[\]/.test(sourceText)) {
    violations.push("INDEX_COLUMN_ORDER");
  }
  if (!/v_key_attribute_count is distinct from 3/.test(sourceText) || !/v_total_attribute_count is distinct from 3/.test(sourceText)) {
    violations.push("INDEX_ATTRIBUTE_COUNTS");
  }
  if (!/v_index_expressions is not null/.test(sourceText)) violations.push("INDEX_EXPRESSIONS");
  if (!sourceText.includes("v_constraint_name is distinct from\n          '" + EXPECTED_INDEX_NAME + "'")) {
    violations.push("RETRY_CONSTRAINT_IDENTITY");
  }
  if (!/pg_catalog\.aclexplode/.test(sourceText) || !/pg_catalog\.acldefault\('f', functions\.proowner\)/.test(sourceText)) {
    violations.push("ACL_ENUMERATION");
  }
  if (!/expanded_acl\.grantee is distinct from functions\.proowner/.test(sourceText)) {
    violations.push("FUNCTION_OWNER_PRESERVATION");
  }
  if (!/v_execute_grant\.grantee = 0[\s\S]*from public'/.test(sourceText)) {
    violations.push("PUBLIC_EXECUTE_CLEANUP");
  }
  if (!/revoke execute on function public\.insert_analysis_artifact_atomic\(uuid, uuid, text, jsonb\) from %I/.test(sourceText)) {
    violations.push("HISTORICAL_EXECUTE_CLEANUP");
  }
  const grants = executable.match(/grant\s+execute\s+on\s+function[\s\S]*?\s+to\s+[a-zA-Z_][a-zA-Z0-9_]*\s*;/gi) || [];
  if (grants.length !== 1 || !/to\s+service_role\s*;/i.test(grants[0])) {
    violations.push("UNAUTHORIZED_EXECUTE_GRANT");
  }
  return violations;
}

function handlerContractViolations(sourceText) {
  const violations = [];
  if (count(sourceText, /\.rpc\("insert_analysis_artifact_atomic"/g) !== 1) violations.push("RPC_CALL_COUNT");
  if (/\.from\("analysis_artifacts"\)/.test(sourceText) || /\.insert\(\{[\s\S]*stage:\s*"vnext_checkpoint1"/.test(sourceText)) {
    violations.push("DIRECT_INSERT_FALLBACK");
  }
  return violations;
}

function expectMigrationMutationRejected(label, mutatedSource, expectedViolation) {
  check(label, migrationContractViolations(mutatedSource).includes(expectedViolation));
}

function shouldRetryUniqueViolation(sqlState, constraintName) {
  return sqlState === "23505" && constraintName === EXPECTED_INDEX_NAME;
}

function cleanedExplicitExecuteGrantees(owner, existingGrantees) {
  const retained = existingGrantees.filter((grantee) => grantee === owner);
  return new Set([...retained, "service_role"]);
}

function legacyWriterContractViolations(writerSources) {
  return writerSources
    .filter(({ source: writerSource }) => writerSource.includes("insert_analysis_artifact_atomic"))
    .map(({ path }) => path);
}

// Migration boundary, scoped preflight, and non-destructive behavior.
check("lock timeout is set locally exactly once", count(migration, /^set local lock_timeout = '2s';$/gm) === 1);
check("statement timeout is set locally exactly once", count(migration, /^set local statement_timeout = '30s';$/gm) === 1);
check("timeout policy is immediately after BEGIN", migration.includes(EXPECTED_TIMEOUT_BLOCK));
check(
  "timeout policy precedes lock, preflight, and DDL",
  migration.indexOf(EXPECTED_STATEMENT_TIMEOUT_SQL) < migration.indexOf("lock table public.analysis_artifacts") &&
    migration.indexOf(EXPECTED_STATEMENT_TIMEOUT_SQL) < migration.indexOf("if exists (") &&
    migration.indexOf(EXPECTED_STATEMENT_TIMEOUT_SQL) < migration.indexOf("create unique index"),
);
check("timeout policy never uses session-wide SET", !/^set\s+(?:lock_timeout|statement_timeout)\s*=/gim.test(executableMigration));
check("complete migration source satisfies the inline timeout contract", hasExactInlineTimeoutPolicy(migration));
expectMigrationMutationRejected(
  "mutation rejects missing timeout line",
  replaceOnce(migration, EXPECTED_LOCK_TIMEOUT_SQL + "\n", ""),
  "INLINE_TIMEOUT_POLICY",
);
expectMigrationMutationRejected(
  "mutation rejects wrong timeout value",
  replaceOnce(migration, EXPECTED_LOCK_TIMEOUT_SQL, "set local lock_timeout = '3s';"),
  "INLINE_TIMEOUT_POLICY",
);
expectMigrationMutationRejected(
  "mutation rejects session-wide SET",
  replaceOnce(migration, EXPECTED_STATEMENT_TIMEOUT_SQL, "set statement_timeout = '30s';"),
  "INLINE_TIMEOUT_POLICY",
);
expectMigrationMutationRejected(
  "mutation rejects timeout policy outside transaction",
  replaceOnce(migration, EXPECTED_TIMEOUT_BLOCK, EXPECTED_LOCK_TIMEOUT_SQL + "\n" + EXPECTED_STATEMENT_TIMEOUT_SQL + "\n\nbegin;"),
  "INLINE_TIMEOUT_POLICY",
);
expectMigrationMutationRejected(
  "mutation rejects timeout policy after lock",
  replaceOnce(
    replaceOnce(migration, EXPECTED_LOCK_TIMEOUT_SQL + "\n" + EXPECTED_STATEMENT_TIMEOUT_SQL + "\n", ""),
    "lock table public.analysis_artifacts in share row exclusive mode;",
    "lock table public.analysis_artifacts in share row exclusive mode;\n" + EXPECTED_LOCK_TIMEOUT_SQL + "\n" + EXPECTED_STATEMENT_TIMEOUT_SQL,
  ),
  "INLINE_TIMEOUT_POLICY",
);
expectMigrationMutationRejected(
  "mutation rejects duplicate timeout line",
  replaceOnce(migration, EXPECTED_STATEMENT_TIMEOUT_SQL, EXPECTED_STATEMENT_TIMEOUT_SQL + "\n" + EXPECTED_STATEMENT_TIMEOUT_SQL),
  "INLINE_TIMEOUT_POLICY",
);
check("migration is explicitly transactional", /^begin;[\s\S]*commit;\s*$/m.test(migration));
check(
  "migration locks writes before the scoped preflight",
  migration.indexOf("lock table public.analysis_artifacts in share row exclusive mode") <
    migration.indexOf("where stage = 'vnext_checkpoint1'"),
);
const preflight = migration.slice(
  migration.indexOf("if exists ("),
  migration.indexOf("  select\n    index_objects.oid"),
);
check("duplicate preflight is Checkpoint 1-only", /where stage = 'vnext_checkpoint1'\s+group by job_id, stage, version/.test(preflight));
check("duplicate preflight detects multiplicity", /having count\(\*\) > 1/.test(preflight));
check("duplicate preflight raises unique violation", /errcode = '23505'/.test(preflight));
check("duplicate failure identifies Checkpoint 1", /duplicate vnext_checkpoint1 versions/.test(preflight));
check("duplicate failure says data is unchanged", /stopped without changing artifact data/.test(preflight));
check("migration never deletes artifacts", !/delete\s+from\s+public\.analysis_artifacts/i.test(executableMigration));
check("migration never updates existing artifacts", !/update\s+public\.analysis_artifacts/i.test(executableMigration));
check("migration never drops schema objects", !/\bdrop\s+(?:constraint|index|table|function)\b/i.test(executableMigration));

// Partial unique index creation and exact catalog validation.
check(
  "creates the named partial unique index",
  /create unique index analysis_artifacts_vnext_checkpoint1_version_uidx\s+on public\.analysis_artifacts \(job_id, stage, version\)\s+where stage = 'vnext_checkpoint1';/.test(migration),
);
check("creates exactly one unique index", count(executableMigration, /create\s+unique\s+index/gi) === 1);
check("does not create a global unique constraint", !/add\s+constraint[\s\S]*?unique\s*\(job_id,\s*stage,\s*version\)/i.test(executableMigration));
check("does not create any table constraint", !/alter\s+table[\s\S]*?add\s+constraint/i.test(executableMigration));
check("catalog lookup fixes index schema to public", /index_namespaces\.nspname = 'public'/.test(migration));
check("catalog lookup fixes the index name", migration.includes("index_objects.relname = '" + EXPECTED_INDEX_NAME + "'"));
check("catalog validation checks object kind", /v_object_kind is distinct from 'i'/.test(migration));
check("catalog validation checks table schema", /v_table_schema is distinct from 'public'/.test(migration));
check("catalog validation checks table name", /v_table_name is distinct from 'analysis_artifacts'/.test(migration));
check("catalog validation checks uniqueness", /v_index_unique is distinct from true/.test(migration));
check("catalog validation checks valid", /v_index_valid is distinct from true/.test(migration));
check("catalog validation checks ready", /v_index_ready is distinct from true/.test(migration));
check("catalog reads ordered indkey attributes", /unnest\(indexes\.indkey\) with ordinality/.test(migration) && /order by keys\.position/.test(migration));
check("catalog requires three key columns", /v_key_attribute_count is distinct from 3/.test(migration));
check("catalog forbids included columns", /v_total_attribute_count is distinct from 3/.test(migration));
check("catalog forbids expression columns", /v_index_expressions is not null/.test(migration));
check(
  "catalog requires exact ordered columns",
  /v_index_columns is distinct from array\['job_id', 'stage', 'version'\]::text\[\]/.test(migration),
);
check("catalog renders the stored predicate", /pg_catalog\.pg_get_expr\(indexes\.indpred, indexes\.indrelid, false\)/.test(migration));
check("catalog performs no lossy predicate normalization", !/regexp_replace|v_normalized_predicate/.test(migration));
check(
  "catalog requires pg_get_expr canonical Checkpoint 1 predicate exactly",
  migration.includes("v_index_predicate is distinct from\n        " + EXPECTED_SQL_PREDICATE_LITERAL),
);
check("bad same-name object fails explicitly", migration.includes("errcode = '42P16'"));
check("name collision is never silently replaced", /Do not drop or replace the existing object automatically/.test(migration));
check(
  "index validation precedes RPC creation",
  migration.indexOf("v_index_predicate is distinct from") <
    migration.indexOf("create or replace function public.insert_analysis_artifact_atomic"),
);
check("complete migration source satisfies the static contract", migrationContractViolations(migration).length === 0);

// Behavioral metadata model for reuse versus explicit failure.
function expectedIndexDecision(candidate) {
  if (candidate === null || candidate.name !== EXPECTED_INDEX_NAME) return "create";
  const correct =
    candidate.objectKind === "i" &&
    candidate.tableSchema === "public" &&
    candidate.tableName === "analysis_artifacts" &&
    candidate.unique === true &&
    candidate.valid === true &&
    candidate.ready === true &&
    candidate.keyAttributeCount === 3 &&
    candidate.totalAttributeCount === 3 &&
    candidate.hasExpressions === false &&
    JSON.stringify(candidate.columns) === JSON.stringify(["job_id", "stage", "version"]) &&
    candidate.predicate === EXPECTED_CANONICAL_PREDICATE;
  return correct ? "reuse" : "fail";
}

const correctIndex = {
  name: EXPECTED_INDEX_NAME,
  objectKind: "i",
  tableSchema: "public",
  tableName: "analysis_artifacts",
  unique: true,
  valid: true,
  ready: true,
  keyAttributeCount: 3,
  totalAttributeCount: 3,
  hasExpressions: false,
  columns: ["job_id", "stage", "version"],
  predicate: "(stage = 'vnext_checkpoint1'::text)",
};
check("correct existing partial index is reused", expectedIndexDecision(correctIndex) === "reuse");
check("missing index is created", expectedIndexDecision(null) === "create");
check("different index name does not satisfy protection", expectedIndexDecision({ ...correctIndex, name: "other" }) === "create");
check("same name on wrong schema fails", expectedIndexDecision({ ...correctIndex, tableSchema: "private" }) === "fail");
check("same name on wrong table fails", expectedIndexDecision({ ...correctIndex, tableName: "other" }) === "fail");
check("same name with non-index object fails", expectedIndexDecision({ ...correctIndex, objectKind: "r" }) === "fail");
check("same name when non-unique fails", expectedIndexDecision({ ...correctIndex, unique: false }) === "fail");
check("same name when invalid fails", expectedIndexDecision({ ...correctIndex, valid: false }) === "fail");
check("same name when not ready fails", expectedIndexDecision({ ...correctIndex, ready: false }) === "fail");
check("same name with missing predicate fails", expectedIndexDecision({ ...correctIndex, predicate: null }) === "fail");
check("same name with wrong predicate fails", expectedIndexDecision({ ...correctIndex, predicate: "stage = 'scope'::text" }) === "fail");
check("same name with parentheses inside literal fails", expectedIndexDecision({ ...correctIndex, predicate: "(stage = 'vnext_(checkpoint1)'::text)" }) === "fail");
check("same name with whitespace inside literal fails", expectedIndexDecision({ ...correctIndex, predicate: "(stage = 'vnext_ checkpoint1'::text)" }) === "fail");
check("same name with similar stage fails", expectedIndexDecision({ ...correctIndex, predicate: "(stage = 'vnext_checkpoint'::text)" }) === "fail");
check("same name with extra predicate character fails", expectedIndexDecision({ ...correctIndex, predicate: "(stage = 'vnext_checkpoint11'::text)" }) === "fail");
check("same name with OR predicate fails", expectedIndexDecision({ ...correctIndex, predicate: "((stage = 'vnext_checkpoint1'::text) OR (stage = 'scope'::text))" }) === "fail");
check("same name with IN predicate fails", expectedIndexDecision({ ...correctIndex, predicate: "(stage = ANY (ARRAY['vnext_checkpoint1'::text]))" }) === "fail");
check("same name with reordered columns fails", expectedIndexDecision({ ...correctIndex, columns: ["stage", "job_id", "version"] }) === "fail");
check("same name with missing column fails", expectedIndexDecision({ ...correctIndex, columns: ["job_id", "version"], keyAttributeCount: 2, totalAttributeCount: 2 }) === "fail");
check("same name with additional key column fails", expectedIndexDecision({ ...correctIndex, columns: ["job_id", "stage", "version", "payload"], keyAttributeCount: 4, totalAttributeCount: 4 }) === "fail");
check("same name with included column fails", expectedIndexDecision({ ...correctIndex, totalAttributeCount: 4 }) === "fail");
check("same name with expression column fails", expectedIndexDecision({ ...correctIndex, hasExpressions: true }) === "fail");

expectMigrationMutationRejected("mutation rejects parentheses inside predicate literal", replaceOnce(migration, EXPECTED_SQL_PREDICATE_LITERAL, "'(stage = ''vnext_(checkpoint1)''::text)'"), "PREDICATE_COMPARISON");
expectMigrationMutationRejected("mutation rejects whitespace inside predicate literal", replaceOnce(migration, EXPECTED_SQL_PREDICATE_LITERAL, "'(stage = ''vnext_ checkpoint1''::text)'"), "PREDICATE_COMPARISON");
expectMigrationMutationRejected("mutation rejects similar stage predicate", replaceOnce(migration, EXPECTED_SQL_PREDICATE_LITERAL, "'(stage = ''vnext_checkpoint''::text)'"), "PREDICATE_COMPARISON");
expectMigrationMutationRejected("mutation rejects extra predicate character", replaceOnce(migration, EXPECTED_SQL_PREDICATE_LITERAL, "'(stage = ''vnext_checkpoint11''::text)'"), "PREDICATE_COMPARISON");
expectMigrationMutationRejected(
  "mutation rejects missing predicate validation",
  replaceOnce(migration, "      or v_index_predicate is distinct from\n        " + EXPECTED_SQL_PREDICATE_LITERAL + "\n", ""),
  "PREDICATE_COMPARISON",
);
expectMigrationMutationRejected("mutation rejects OR predicate", replaceOnce(migration, EXPECTED_SQL_PREDICATE_LITERAL, "'((stage = ''vnext_checkpoint1''::text) OR (stage = ''scope''::text))'"), "PREDICATE_COMPARISON");
expectMigrationMutationRejected("mutation rejects IN predicate", replaceOnce(migration, EXPECTED_SQL_PREDICATE_LITERAL, "'(stage = ANY (ARRAY[''vnext_checkpoint1''::text]))'"), "PREDICATE_COMPARISON");
expectMigrationMutationRejected("mutation rejects global unique index", replaceOnce(migration, "      where stage = 'vnext_checkpoint1';", ";"), "PARTIAL_INDEX_DEFINITION");
expectMigrationMutationRejected("mutation rejects reordered catalog columns", replaceOnce(migration, "array['job_id', 'stage', 'version']::text[]", "array['stage', 'job_id', 'version']::text[]"), "INDEX_COLUMN_ORDER");
expectMigrationMutationRejected("mutation rejects additional catalog key column", replaceOnce(migration, "array['job_id', 'stage', 'version']::text[]", "array['job_id', 'stage', 'version', 'payload']::text[]"), "INDEX_COLUMN_ORDER");
expectMigrationMutationRejected("mutation rejects removed expression guard", replaceOnce(migration, "      or v_index_expressions is not null\n", ""), "INDEX_EXPRESSIONS");
expectMigrationMutationRejected("mutation rejects removed INCLUDE guard", replaceOnce(migration, "      or v_total_attribute_count is distinct from 3\n", ""), "INDEX_ATTRIBUTE_COUNTS");

// RPC stage boundary, transaction, allocation, and retry.
function rpcAcceptsStage(stage) {
  return stage === "vnext_checkpoint1";
}
check("RPC model accepts Checkpoint 1", rpcAcceptsStage("vnext_checkpoint1"));
check("RPC model rejects another stage", !rpcAcceptsStage("scope"));
check("RPC model rejects NULL", !rpcAcceptsStage(null));
check("RPC model rejects empty stage", !rpcAcceptsStage(""));
check("RPC model rejects whitespace stage", !rpcAcceptsStage(" "));
check("atomic RPC is created", /function public\.insert_analysis_artifact_atomic\(/.test(migration));
check("RPC uses schema-qualified tables", /from public\.analysis_jobs/.test(migration) && /into public\.analysis_artifacts/.test(migration));
check("RPC is security invoker", /language plpgsql\s+security invoker/.test(migration));
check("RPC has empty search_path", /set search_path = ''/.test(migration));
check("RPC rejects every non-exact stage including NULL", /if p_stage is distinct from 'vnext_checkpoint1' then/.test(migration));
check("RPC no longer uses an empty-only stage guard", !/btrim\(p_stage\)\s*=\s*''/.test(migration));
check("RPC locks the collision-free parent row", /where jobs\.id = p_job_id\s+for update;/.test(migration));
check("RPC verifies the denormalized user owner", /v_job_user_id <> p_user_id/.test(migration));
check("RPC rejects caller supplied attempt", /if p_payload \? 'attempt'/.test(migration));
check("RPC computes next version in the database", /coalesce\(max\(artifacts\.version\), 0\) \+ 1/.test(migration));
check("RPC allocation query is fixed to Checkpoint 1", /where artifacts\.job_id = p_job_id\s+and artifacts\.stage = 'vnext_checkpoint1'/.test(migration));
check("RPC insert stage is fixed to Checkpoint 1", /p_user_id,\s+'vnext_checkpoint1',\s+v_version/.test(migration));
check("RPC inserts allocation and payload together", /insert into public\.analysis_artifacts[\s\S]*v_version,[\s\S]*jsonb_build_object\('attempt', v_version\)/.test(migration));
check("RPC retries only unique violations", /when unique_violation then/.test(migration));
check("RPC checks only the expected partial index before retry", migration.includes("v_constraint_name is distinct from\n          '" + EXPECTED_INDEX_NAME + "'"));
check("retry model accepts only matching unique violation", shouldRetryUniqueViolation("23505", EXPECTED_INDEX_NAME));
check("retry model rejects NULL constraint name", !shouldRetryUniqueViolation("23505", null));
check("retry model rejects another constraint name", !shouldRetryUniqueViolation("23505", "analysis_artifacts_pkey"));
check("retry model rejects matching name for non-unique SQLSTATE", !shouldRetryUniqueViolation("23503", EXPECTED_INDEX_NAME));
expectMigrationMutationRejected("mutation rejects NULL-unsafe constraint comparison", replaceOnce(migration, "v_constraint_name is distinct from", "v_constraint_name <>"), "RETRY_CONSTRAINT_IDENTITY");
check("RPC retry is bounded at three attempts", /v_retry_count >= 3/.test(migration));
check("RPC returns only UUID id and integer version", /returns table \(\s*artifact_id uuid,\s*artifact_version integer\s*\)/.test(migration));

// Permission boundary.
check("permission cleanup enumerates effective default or explicit ACL", /pg_catalog\.aclexplode[\s\S]*pg_catalog\.acldefault\('f', functions\.proowner\)/.test(migration));
check("permission cleanup preserves the function owner", /expanded_acl\.grantee is distinct from functions\.proowner/.test(migration));
check("permission cleanup handles PUBLIC grantee zero", /v_execute_grant\.grantee = 0[\s\S]*from public'/.test(migration));
check("permission cleanup revokes historical named roles dynamically", /from %I'[\s\S]*v_execute_grant\.grantee_name/.test(migration));
check("function owner is resolved and granted execute explicitly", /into v_function_owner[\s\S]*grant execute[\s\S]*v_function_owner/.test(migration));
check("service role is the only explicit non-owner role granted execute", /grant execute[\s\S]*to service_role;/.test(migration));
const cleanedGrants = cleanedExplicitExecuteGrantees("migration_owner", ["PUBLIC", "anon", "authenticated", "legacy_reporter", "migration_owner"]);
check("ACL model removes historical extra role", !cleanedGrants.has("legacy_reporter"));
check("ACL model removes PUBLIC", !cleanedGrants.has("PUBLIC"));
check("ACL model retains owner and service role only", cleanedGrants.size === 2 && cleanedGrants.has("migration_owner") && cleanedGrants.has("service_role"));
expectMigrationMutationRejected("mutation rejects historical role grant after cleanup", migration + "\ngrant execute on function public.insert_analysis_artifact_atomic(uuid, uuid, text, jsonb) to legacy_reporter;\n", "UNAUTHORIZED_EXECUTE_GRANT");
expectMigrationMutationRejected("mutation rejects PUBLIC grant after cleanup", migration + "\ngrant execute on function public.insert_analysis_artifact_atomic(uuid, uuid, text, jsonb) to public;\n", "UNAUTHORIZED_EXECUTE_GRANT");
check("RPC is not security definer", !/function public\.insert_analysis_artifact_atomic[\s\S]*security definer/.test(migration));

// Handler contract and absence of a direct-insert fallback.
check("Checkpoint 1 calls the atomic RPC once", count(handler, /\.rpc\("insert_analysis_artifact_atomic"/g) === 1);
check("Checkpoint 1 passes the exact stage", /p_stage:\s*"vnext_checkpoint1"/.test(handler));
check("Checkpoint 1 does not directly access artifacts", !/\.from\("analysis_artifacts"\)/.test(handler));
check("Checkpoint 1 does not select artifact version", !/\.select\("version"\)/.test(handler));
check("Checkpoint 1 contains no client version increment", !/\.version\s*\+\s*1/.test(handler));
check("Checkpoint 1 contains no direct artifact insert", !/\.insert\(\{[\s\S]*stage:\s*"vnext_checkpoint1"/.test(handler));
check("Checkpoint 1 passes all four RPC parameters", ["p_job_id", "p_user_id", "p_stage", "p_payload"].every((key) => handler.includes(key + ":")));
check("Checkpoint 1 validates returned artifact id", /!isCanonicalUuid\(\(artifactRow as \{ artifact_id\?: unknown \}\)\.artifact_id\)/.test(handler));
check("Checkpoint 1 validates returned positive version", /artifact_version: number[\s\S]*< 1/.test(handler));
check("Checkpoint 1 keeps server incident ids", /crypto\.randomUUID\(\)/.test(handler));
check("Checkpoint 1 does not log raw DB errors", !/console\.error\([^;]*artifactError/s.test(handler));
check("Checkpoint 1 does not return raw DB errors", !/jsonResponse\([^;]*artifactError/s.test(handler));
check("Checkpoint 1 documents no direct fallback", /There is deliberately no direct-insert\s+\/\/ fallback/.test(handler));
check("complete handler source satisfies the persistence contract", handlerContractViolations(handler).length === 0);
check("mutation rejects direct-insert fallback", handlerContractViolations(handler + '\nconst forbiddenFallback = supabase.from("analysis_artifacts").insert({ stage: "vnext_checkpoint1" });\n').includes("DIRECT_INSERT_FALLBACK"));

// Payload attempt is absent before the RPC and equals the returned version.
const input = buildVnextCheckpoint1PayloadInput({
  model: "test-model",
  geometry: { status: "call_failed", observation: null, validation: null, error: { category: "provider", code: "x", stage: "geometry", message: "safe", status: null, requestId: null } },
  evidence: { status: "call_failed", observation: null, validation: null, error: { category: "provider", code: "x", stage: "evidence", message: "safe", status: null, requestId: null } },
  geometryDurationMs: 1,
  evidenceDurationMs: 2,
  totalWallClockMs: 2,
  geometryUsage: null,
  evidenceUsage: null,
});
check("RPC payload input has no attempt", !("attempt" in input));
const finalized = withVnextCheckpoint1Attempt(input, 17);
check("response attempt uses DB artifact version", finalized.attempt === 17);
check("finalization does not mutate RPC input", !("attempt" in input));
check("canonical UUID validator accepts canonical UUID", isCanonicalUuid("123e4567-e89b-12d3-a456-426614174000"));
check("canonical UUID validator rejects non-UUID", !isCanonicalUuid("not-a-uuid"));
check("canonical UUID validator rejects braces", !isCanonicalUuid("{123e4567-e89b-12d3-a456-426614174000}"));

// Deterministic concurrency model. This is not a PostgreSQL execution test.
const observedMax = 8;
const oldCandidates = [observedMax + 1, observedMax + 1];
check("old split allocation model duplicates a candidate", new Set(oldCandidates).size === 1);

class PerJobAtomicAllocator {
  #tails = new Map();
  #versions = new Map();

  allocate(jobId) {
    const previous = this.#tails.get(jobId) ?? Promise.resolve();
    const current = previous.then(async () => {
      await Promise.resolve();
      const next = (this.#versions.get(jobId) ?? 0) + 1;
      this.#versions.set(jobId, next);
      return next;
    });
    this.#tails.set(jobId, current.catch(() => undefined));
    return current;
  }
}

const allocator = new PerJobAtomicAllocator();
const concurrent = await Promise.all(
  Array.from({ length: 40 }, () => allocator.allocate("job-a")),
);
check("atomic model returns forty unique versions", new Set(concurrent).size === 40);
check("atomic model is monotonic without gaps", concurrent.slice().sort((a, b) => a - b).every((value, index) => value === index + 1));
const independent = await Promise.all([allocator.allocate("job-b"), allocator.allocate("job-c")]);
check("different jobs retain independent sequences", independent[0] === 1 && independent[1] === 1);

function checkpointDuplicatePreflight(rows) {
  const snapshot = structuredClone(rows);
  const keys = new Set();
  for (const row of rows.filter((row) => row.stage === "vnext_checkpoint1")) {
    const key = row.jobId + "\u0000" + row.stage + "\u0000" + row.version;
    if (keys.has(key)) throw new Error("duplicate");
    keys.add(key);
  }
  return snapshot;
}
let checkpointDuplicateFailed = false;
try {
  checkpointDuplicatePreflight([
    { id: "a", jobId: "j", stage: "vnext_checkpoint1", version: 1 },
    { id: "b", jobId: "j", stage: "vnext_checkpoint1", version: 1 },
  ]);
} catch {
  checkpointDuplicateFailed = true;
}
check("preflight model rejects Checkpoint 1 duplicates", checkpointDuplicateFailed);
let legacyDuplicatesSurvive = true;
try {
  const rows = [
    { id: "a", jobId: "j", stage: "scope", version: 1 },
    { id: "b", jobId: "j", stage: "scope", version: 1 },
  ];
  const snapshot = checkpointDuplicatePreflight(rows);
  legacyDuplicatesSurvive = snapshot.length === 2;
} catch {
  legacyDuplicatesSurvive = false;
}
check("preflight model ignores legacy-stage duplicates", legacyDuplicatesSurvive);

// The six legacy writer sources must remain byte-for-byte identical to HEAD
// and must not call the Checkpoint 1-only RPC.
for (const path of LEGACY_WRITERS) {
  let unchanged = true;
  try {
    execFileSync("git", ["diff", "--quiet", "HEAD", "--", path], { stdio: "ignore" });
  } catch {
    unchanged = false;
  }
  check("legacy writer unchanged: " + path, unchanged);
  check(
    "legacy writer does not call Checkpoint 1 RPC: " + path,
    !readFileSync("./" + path, "utf8").includes('insert_analysis_artifact_atomic'),
  );
}
const legacyWriterSources = LEGACY_WRITERS.map((path) => ({ path, source: readFileSync("./" + path, "utf8") }));
check("legacy writer contract accepts all current writers", legacyWriterContractViolations(legacyWriterSources).length === 0);
const mutatedLegacyWriters = legacyWriterSources.map((writer, index) => index === 0
  ? { ...writer, source: writer.source + '\ninsert_analysis_artifact_atomic' }
  : writer);
check("negative control rejects a legacy writer changed to call the new RPC", legacyWriterContractViolations(mutatedLegacyWriters).length === 1);

check(
  "only Checkpoint 1 source calls the RPC among reviewed writers",
  [handlerPath, ...LEGACY_WRITERS].filter((path) =>
    readFileSync("./" + path, "utf8").includes('insert_analysis_artifact_atomic')
  ).length === 1,
);

// Documentation must preserve the offline verification boundary.
check("blocker records Checkpoint 1-only partial index", blockers.includes("partial UNIQUE index"));
check("blocker records legacy stages remain unaffected", blockers.includes("legacy"));
check("blocker records migration remains unapplied", blockers.includes("has not been applied"));
check("blocker records no deployment", blockers.includes("No Edge Function has been deployed"));

console.log("SHIFT_CHECKPOINT1_TEST_SUMMARY " + JSON.stringify({
  testFileId: "atomic_versioning",
  assertionsPassed,
  assertionsFailed,
  completed: true,
}));
process.exitCode = assertionsFailed === 0 ? 0 : 1;
} catch (error) {
  if (!bootstrapDiagnosticWritten) {
    const safeMessage = error instanceof Error ? error.message : "unknown bootstrap error";
    console.error("ATOMIC_TEST_BOOTSTRAP_FAILED: " + safeMessage);
  }
  process.exitCode = 2;
} finally {
  if (temporaryBuildDirectory !== null) {
    rmSync(temporaryBuildDirectory, { recursive: true, force: true });
  }
}
