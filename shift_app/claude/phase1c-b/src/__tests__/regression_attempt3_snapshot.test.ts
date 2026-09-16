// Regression test required by the PHASE 1C CANONICAL CONTRACT IMPLEMENTATION
// spec (item 8): prove that moving constructCanonicalTopology onto the
// shared supabase/functions/_shared/canonical_topology_v1.ts contract did not
// change the constructor's output by even one byte.
//
// attempt3-actual-candidate.json is not a fixture invented for this test --
// it is the same golden snapshot already committed at
// claude/phase2b-part-a/src/fixtures/attempt3-actual-candidate.json (copied
// here verbatim, byte-for-byte -- see the session's diff). That file was
// independently verified in the FINAL CONTRACT VERIFICATION session by
// extracting the real phase1c-b-complete.zip, compiling it standalone with
// tsc --strict, and running constructCanonicalTopology(attempt3Raw,
// attempt3ApprovedPlan, 'attempt3-candidate') directly, then diffing its
// stdout against this exact JSON -- identical. This test re-runs the SAME
// construction, but now through the package that imports the shared
// canonical_topology_v1.ts contract instead of a private model.ts copy, and
// asserts deep equality against that same golden JSON.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { constructCanonicalTopology } from '../construct.js';
import { attempt3Raw, attempt3ApprovedPlan } from '../fixtures/attempt3.js';
import type { CanonicalTopologyCandidate } from '../types/canonical_topology_v1.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

test('REGRESSION: constructCanonicalTopology on Attempt #3 fixtures, run through the shared canonical_topology_v1 contract, is deep-equal to the golden attempt3-actual-candidate.json produced by the original phase1c-b-complete.zip', () => {
  const golden: CanonicalTopologyCandidate = JSON.parse(
    readFileSync(join(__dirname, '..', 'fixtures', 'attempt3-actual-candidate.json'), 'utf8'),
  );

  const candidate = constructCanonicalTopology(
    attempt3Raw,
    attempt3ApprovedPlan,
    'attempt3-candidate',
  );

  // JSON round-trip on the actual output so the comparison is exactly what a
  // persisted/serialized candidate would look like (matches how the golden
  // file itself was produced), and so structural/key-order differences that
  // don't affect deepEqual can't hide a real behavioral change.
  const candidateAsJson = JSON.parse(JSON.stringify(candidate));

  assert.deepEqual(
    candidateAsJson,
    golden,
    'constructCanonicalTopology output changed after migrating to the shared canonical_topology_v1.ts contract -- this must never happen; STOP and do not alter constructCanonicalTopology behavior.',
  );
});
