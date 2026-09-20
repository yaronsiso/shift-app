import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const TEST_SUMMARY_PREFIX = "SHIFT_CHECKPOINT1_TEST_SUMMARY ";
export const VALIDATED_FILE_PREFIX = "SHIFT_CHECKPOINT1_VALIDATED_FILE ";

export class Checkpoint1TestProtocolError extends Error {
  constructor(code, detail) {
    super(`${code}: ${detail}`);
    this.name = "Checkpoint1TestProtocolError";
    this.code = code;
  }
}

function fail(code, detail) {
  throw new Checkpoint1TestProtocolError(code, detail);
}

function nonEmptyLines(stdout) {
  return stdout.split(/\r?\n/).filter((line) => line.length > 0);
}

export function validateTestExecution({
  fileExists,
  exitCode,
  stdout,
  stderr = "",
  expectedTestFileId,
  expectedAssertions,
}) {
  if (!fileExists) fail("TEST_FILE_MISSING", "test file does not exist");
  if (exitCode !== 0) fail("TEST_EXIT_NONZERO", `test exited with ${String(exitCode)}`);
  if (stderr.length > 0) fail("UNEXPECTED_STDERR", "successful test emitted stderr");

  const lines = nonEmptyLines(stdout);
  const summaryLines = lines.filter((line) => line.startsWith(TEST_SUMMARY_PREFIX));
  if (summaryLines.length === 0) fail("SUMMARY_MISSING", "no structured summary found");
  if (summaryLines.length > 1) fail("SUMMARY_DUPLICATE", "more than one structured summary found");
  if (lines.length !== 1) fail("UNEXPECTED_STDOUT", "stdout contains output outside the single summary");

  let summary;
  try {
    summary = JSON.parse(summaryLines[0].slice(TEST_SUMMARY_PREFIX.length));
  } catch {
    fail("SUMMARY_INVALID_JSON", "summary payload is not valid JSON");
  }

  if (summary === null || typeof summary !== "object" || Array.isArray(summary)) {
    fail("SUMMARY_INVALID_SHAPE", "summary must be an object");
  }
  const expectedKeys = ["assertionsFailed", "assertionsPassed", "completed", "testFileId"];
  const actualKeys = Object.keys(summary).sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    fail("SUMMARY_INVALID_SHAPE", "summary keys do not match the protocol");
  }
  if (
    typeof summary.testFileId !== "string" ||
    !Number.isInteger(summary.assertionsPassed) ||
    summary.assertionsPassed < 0 ||
    !Number.isInteger(summary.assertionsFailed) ||
    summary.assertionsFailed < 0 ||
    typeof summary.completed !== "boolean"
  ) {
    fail("SUMMARY_INVALID_SHAPE", "summary field types are invalid");
  }
  if (summary.testFileId !== expectedTestFileId) {
    fail("TEST_FILE_ID_MISMATCH", `expected ${expectedTestFileId}, got ${summary.testFileId}`);
  }
  if (summary.completed !== true) fail("TEST_NOT_COMPLETED", "completed must be true");
  if (summary.assertionsFailed !== 0) {
    fail("ASSERTIONS_FAILED", `expected 0, got ${summary.assertionsFailed}`);
  }
  if (summary.assertionsPassed !== expectedAssertions) {
    fail(
      "ASSERTIONS_PASSED_MISMATCH",
      `expected ${expectedAssertions}, got ${summary.assertionsPassed}`,
    );
  }
  return summary;
}

function runCli() {
  const [, , testFile, expectedTestFileId, expectedAssertionsRaw] = process.argv;
  const expectedAssertions = Number(expectedAssertionsRaw);
  if (!testFile || !expectedTestFileId || !Number.isInteger(expectedAssertions)) {
    console.error("usage: node checkpoint1_test_protocol.mjs <test-file> <test-file-id> <expected-assertions>");
    process.exit(2);
  }

  const fileExists = existsSync(testFile);
  let result = { status: 0, stdout: "", stderr: "" };
  if (fileExists) {
    result = spawnSync(process.execPath, [testFile], {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
    if (result.error) {
      console.error(`TEST_RUNNER_ERROR: ${result.error.name}`);
      process.exit(2);
    }
  }

  try {
    const summary = validateTestExecution({
      fileExists,
      exitCode: result.status,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      expectedTestFileId,
      expectedAssertions,
    });
    console.log(VALIDATED_FILE_PREFIX + JSON.stringify(summary));
  } catch (error) {
    const code = error instanceof Checkpoint1TestProtocolError ? error.code : "UNKNOWN_PROTOCOL_ERROR";
    console.error(`TEST_PROTOCOL_ERROR ${code}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}
