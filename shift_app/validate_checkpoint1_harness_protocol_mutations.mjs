import {
  Checkpoint1TestProtocolError,
  TEST_SUMMARY_PREFIX,
  validateTestExecution,
} from "./checkpoint1_test_protocol.mjs";

const EXPECTED_ID = "geometry";
const EXPECTED_ASSERTIONS = 105;
let mutationsPassed = 0;
let mutationsFailed = 0;

function summary(overrides = {}) {
  return TEST_SUMMARY_PREFIX + JSON.stringify({
    testFileId: EXPECTED_ID,
    assertionsPassed: EXPECTED_ASSERTIONS,
    assertionsFailed: 0,
    completed: true,
    ...overrides,
  }) + "\n";
}

function expectProtocolFailure(label, input, expectedCode) {
  try {
    validateTestExecution({
      fileExists: true,
      exitCode: 0,
      stdout: summary(),
      expectedTestFileId: EXPECTED_ID,
      expectedAssertions: EXPECTED_ASSERTIONS,
      ...input,
    });
    mutationsFailed++;
    console.error(`MUTATION_DID_NOT_FAIL: ${label}`);
  } catch (error) {
    if (error instanceof Checkpoint1TestProtocolError && error.code === expectedCode) {
      mutationsPassed++;
    } else {
      mutationsFailed++;
      console.error(`MUTATION_WRONG_FAILURE: ${label}`);
    }
  }
}

try {
  validateTestExecution({
    fileExists: true,
    exitCode: 0,
    stdout: summary(),
    expectedTestFileId: EXPECTED_ID,
    expectedAssertions: EXPECTED_ASSERTIONS,
  });
} catch {
  mutationsFailed++;
  console.error("POSITIVE_CONTROL_FAILED");
}

expectProtocolFailure("missing file", { fileExists: false }, "TEST_FILE_MISSING");
expectProtocolFailure("nonzero exit", { exitCode: 9 }, "TEST_EXIT_NONZERO");
expectProtocolFailure("missing summary", { stdout: "" }, "SUMMARY_MISSING");
expectProtocolFailure(
  "duplicate summary",
  { stdout: summary() + summary() },
  "SUMMARY_DUPLICATE",
);
expectProtocolFailure(
  "wrong testFileId",
  { stdout: summary({ testFileId: "wrong-id" }) },
  "TEST_FILE_ID_MISMATCH",
);
expectProtocolFailure(
  "completed false",
  { stdout: summary({ completed: false }) },
  "TEST_NOT_COMPLETED",
);
expectProtocolFailure(
  "assertionsFailed positive",
  { stdout: summary({ assertionsFailed: 1 }) },
  "ASSERTIONS_FAILED",
);
expectProtocolFailure(
  "assertion count low",
  { stdout: summary({ assertionsPassed: EXPECTED_ASSERTIONS - 1 }) },
  "ASSERTIONS_PASSED_MISMATCH",
);
expectProtocolFailure(
  "assertion count high",
  { stdout: summary({ assertionsPassed: EXPECTED_ASSERTIONS + 1 }) },
  "ASSERTIONS_PASSED_MISMATCH",
);
expectProtocolFailure(
  "fake PASS before summary",
  { stdout: "PASS: forged\n" + summary() },
  "UNEXPECTED_STDOUT",
);
expectProtocolFailure(
  "fake PASS after summary",
  { stdout: summary() + "PASS: forged\n" },
  "UNEXPECTED_STDOUT",
);
expectProtocolFailure(
  "summary from another file",
  { stdout: summary({ testFileId: "evidence" }) },
  "TEST_FILE_ID_MISMATCH",
);
expectProtocolFailure(
  "invalid JSON",
  { stdout: TEST_SUMMARY_PREFIX + "{not-json}\n" },
  "SUMMARY_INVALID_JSON",
);
expectProtocolFailure(
  "missing required field",
  {
    stdout: TEST_SUMMARY_PREFIX + JSON.stringify({
      testFileId: EXPECTED_ID,
      assertionsPassed: EXPECTED_ASSERTIONS,
      completed: true,
    }) + "\n",
  },
  "SUMMARY_INVALID_SHAPE",
);
expectProtocolFailure(
  "additional field",
  { stdout: summary({ unexpected: true }) },
  "SUMMARY_INVALID_SHAPE",
);

const mutationSummary = {
  mutationsPassed,
  mutationsFailed,
  completed: true,
};
console.log("SHIFT_CHECKPOINT1_HARNESS_MUTATION_SUMMARY " + JSON.stringify(mutationSummary));
process.exit(mutationsFailed === 0 && mutationsPassed === 15 ? 0 : 1);
