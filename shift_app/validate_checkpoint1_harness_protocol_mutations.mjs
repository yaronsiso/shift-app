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

// The original 15 mutations above remain locked. The atomic suite uses the
// same strict protocol with its own identity and assertion count.
const ORIGINAL_MUTATIONS = 15;
const ATOMIC_EXPECTED_ID = "atomic_versioning";
const ATOMIC_EXPECTED_ASSERTIONS = 153;
const originalMutationsPassed = mutationsPassed;
const originalMutationsFailed = mutationsFailed;

function atomicSummary(overrides = {}) {
  return TEST_SUMMARY_PREFIX + JSON.stringify({
    testFileId: ATOMIC_EXPECTED_ID,
    assertionsPassed: ATOMIC_EXPECTED_ASSERTIONS,
    assertionsFailed: 0,
    completed: true,
    ...overrides,
  }) + "\n";
}

function expectAtomicProtocolFailure(label, input, expectedCode) {
  try {
    validateTestExecution({
      fileExists: true,
      exitCode: 0,
      stdout: atomicSummary(),
      expectedTestFileId: ATOMIC_EXPECTED_ID,
      expectedAssertions: ATOMIC_EXPECTED_ASSERTIONS,
      ...input,
    });
    mutationsFailed++;
    console.error(`ATOMIC_MUTATION_DID_NOT_FAIL: ${label}`);
  } catch (error) {
    if (error instanceof Checkpoint1TestProtocolError && error.code === expectedCode) {
      mutationsPassed++;
    } else {
      mutationsFailed++;
      console.error(`ATOMIC_MUTATION_WRONG_FAILURE: ${label}`);
    }
  }
}

try {
  validateTestExecution({
    fileExists: true,
    exitCode: 0,
    stdout: atomicSummary(),
    expectedTestFileId: ATOMIC_EXPECTED_ID,
    expectedAssertions: ATOMIC_EXPECTED_ASSERTIONS,
  });
} catch {
  mutationsFailed++;
  console.error("ATOMIC_POSITIVE_CONTROL_FAILED");
}

expectAtomicProtocolFailure("atomic missing summary", { stdout: "" }, "SUMMARY_MISSING");
expectAtomicProtocolFailure("atomic duplicate summary", { stdout: atomicSummary() + atomicSummary() }, "SUMMARY_DUPLICATE");
expectAtomicProtocolFailure("atomic wrong testFileId", { stdout: atomicSummary({ testFileId: "wrong-atomic-id" }) }, "TEST_FILE_ID_MISMATCH");
expectAtomicProtocolFailure("atomic completed false", { stdout: atomicSummary({ completed: false }) }, "TEST_NOT_COMPLETED");
expectAtomicProtocolFailure("atomic assertionsFailed positive", { stdout: atomicSummary({ assertionsFailed: 1 }) }, "ASSERTIONS_FAILED");
expectAtomicProtocolFailure("atomic assertion count low", { stdout: atomicSummary({ assertionsPassed: ATOMIC_EXPECTED_ASSERTIONS - 1 }) }, "ASSERTIONS_PASSED_MISMATCH");
expectAtomicProtocolFailure("atomic assertion count high", { stdout: atomicSummary({ assertionsPassed: ATOMIC_EXPECTED_ASSERTIONS + 1 }) }, "ASSERTIONS_PASSED_MISMATCH");
expectAtomicProtocolFailure("atomic fake stdout before", { stdout: "PASS: forged\n" + atomicSummary() }, "UNEXPECTED_STDOUT");
expectAtomicProtocolFailure("atomic fake stdout after", { stdout: atomicSummary() + "PASS: forged\n" }, "UNEXPECTED_STDOUT");
expectAtomicProtocolFailure("atomic invalid JSON", { stdout: TEST_SUMMARY_PREFIX + "{not-json}\n" }, "SUMMARY_INVALID_JSON");
expectAtomicProtocolFailure(
  "atomic missing required field",
  { stdout: TEST_SUMMARY_PREFIX + JSON.stringify({
    testFileId: ATOMIC_EXPECTED_ID,
    assertionsPassed: ATOMIC_EXPECTED_ASSERTIONS,
    completed: true,
  }) + "\n" },
  "SUMMARY_INVALID_SHAPE",
);
expectAtomicProtocolFailure("atomic additional field", { stdout: atomicSummary({ unexpected: true }) }, "SUMMARY_INVALID_SHAPE");

const ATOMIC_MUTATIONS = 12;
const EXPECTED_MUTATIONS = ORIGINAL_MUTATIONS + ATOMIC_MUTATIONS;
if (originalMutationsPassed !== ORIGINAL_MUTATIONS || originalMutationsFailed !== 0) {
  mutationsFailed++;
  console.error("ORIGINAL_MUTATION_LOCK_FAILED");
}

const mutationSummary = {
  mutationsPassed,
  mutationsFailed,
  completed: true,
};
console.log("SHIFT_CHECKPOINT1_HARNESS_MUTATION_SUMMARY " + JSON.stringify(mutationSummary));
process.exit(mutationsFailed === 0 && mutationsPassed === EXPECTED_MUTATIONS ? 0 : 1);
