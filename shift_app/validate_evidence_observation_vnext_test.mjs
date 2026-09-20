// validate_evidence_observation_vnext_test.mjs
//
// SHIFT VNext Checkpoint 1 — tests for EvidenceObservationVNext's schema
// acceptance/forbidden-field guard and structural validator.

import {
  parseEvidenceObservationVNext,
  EvidenceObservationVNextForbiddenFieldError,
} from "./build/evidence_observation_schema_vnext.js";
import { validateEvidenceObservationVNext } from "./build/evidence_observation_validators_vnext.js";

const TEST_FILE_ID = "evidence";
let assertionsPassed = 0;
let failures = 0;
function check(label, cond) {
  if (cond) { assertionsPassed++; }
  else { console.error(`ASSERTION_FAILED: ${label}`); failures++; }
}

function p(x, y) { return { xPct: x, yPct: y }; }

function baseValidEvidence() {
  return {
    schemaVersion: "evidence_observation_vnext_v1",
    dimensionEvidence: [
      {
        id: "d1",
        rawText: "1669",
        lineStartPct: p(7, 20),
        lineEndPct: p(98, 20),
        unitHint: "uncertain",
        confidence: "high",
      },
      {
        id: "d2",
        rawText: "274",
        lineStartPct: null,
        lineEndPct: null,
        unitHint: null,
        confidence: "medium",
      },
    ],
    textLabels: [
      { id: "l1", rawText: "סלון", anchorImagePct: p(50, 50), roleHint: "room_label" },
    ],
  };
}

// ---------------------------------------------------------------------
// Test 1: schema acceptance — well-formed evidence passes cleanly.
// ---------------------------------------------------------------------
{
  const raw = baseValidEvidence();
  const parsed = parseEvidenceObservationVNext(raw);
  const result = validateEvidenceObservationVNext(parsed);
  check("Test 1: well-formed evidence parses without throwing", true);
  check(`Test 1: well-formed evidence validates as valid (errors=${JSON.stringify(result.errors)})`, result.valid === true);
}

// ---------------------------------------------------------------------
// Test 2: rawText is never converted — the exact printed text ("1669")
// must survive untouched, never becoming a converted numeric value.
// ---------------------------------------------------------------------
{
  const raw = baseValidEvidence();
  const parsed = parseEvidenceObservationVNext(raw);
  check("Test 2: rawText preserved verbatim ('1669', not 16.69)", parsed.dimensionEvidence[0].rawText === "1669");
}

// ---------------------------------------------------------------------
// Test 3: forbidden fields — a smuggled valueM/isOverall/classification
// anywhere must throw.
// ---------------------------------------------------------------------
{
  const raw = baseValidEvidence();
  raw.dimensionEvidence[0].valueM = 16.69;
  let threw = false, isRightError = false;
  try { parseEvidenceObservationVNext(raw); }
  catch (err) { threw = true; isRightError = err instanceof EvidenceObservationVNextForbiddenFieldError; }
  check("Test 3: forbidden field 'valueM' throws", threw);
  check("Test 3: thrown error is EvidenceObservationVNextForbiddenFieldError", isRightError);
}
{
  const raw = baseValidEvidence();
  raw.dimensionEvidence[0].isOverall = true;
  let threw = false;
  try { parseEvidenceObservationVNext(raw); } catch (err) { threw = err instanceof EvidenceObservationVNextForbiddenFieldError; }
  check("Test 3b: forbidden field 'isOverall' (overall/local classification) throws", threw);
}
{
  const raw = baseValidEvidence();
  raw.textLabels[0].areaSqm = 12;
  let threw = false;
  try { parseEvidenceObservationVNext(raw); } catch (err) { threw = err instanceof EvidenceObservationVNextForbiddenFieldError; }
  check("Test 3c: forbidden field 'areaSqm' throws", threw);
}

// ---------------------------------------------------------------------
// Test 4: duplicate ids — fatal.
// ---------------------------------------------------------------------
{
  const raw = baseValidEvidence();
  raw.dimensionEvidence.push({ ...raw.dimensionEvidence[0] });
  const result = validateEvidenceObservationVNext(raw);
  check("Test 4: duplicate dimensionEvidence id is invalid", result.valid === false);
  check("Test 4: DUPLICATE_DIMENSION_EVIDENCE_ID reported", result.errors.some((e) => e.code === "DUPLICATE_DIMENSION_EVIDENCE_ID"));
}
{
  const raw = baseValidEvidence();
  raw.textLabels.push({ ...raw.textLabels[0] });
  const result = validateEvidenceObservationVNext(raw);
  check("Test 4b: duplicate textLabel id is invalid", result.valid === false);
  check("Test 4b: DUPLICATE_TEXT_LABEL_ID reported", result.errors.some((e) => e.code === "DUPLICATE_TEXT_LABEL_ID"));
}

// ---------------------------------------------------------------------
// Test 5: non-finite / out-of-range coordinates — fatal.
// ---------------------------------------------------------------------
{
  const raw = baseValidEvidence();
  raw.textLabels[0].anchorImagePct = { xPct: Infinity, yPct: 10 };
  const result = validateEvidenceObservationVNext(raw);
  check("Test 5: non-finite coordinate is invalid", result.valid === false);
  check("Test 5: MALFORMED_COORDINATE reported", result.errors.some((e) => e.code === "MALFORMED_COORDINATE"));
}
{
  const raw = baseValidEvidence();
  raw.dimensionEvidence[0].lineStartPct = { xPct: -9999, yPct: 20 };
  const result = validateEvidenceObservationVNext(raw);
  check("Test 5b: grossly out-of-range coordinate is invalid", result.valid === false);
  check("Test 5b: OUT_OF_RANGE_COORDINATE reported", result.errors.some((e) => e.code === "OUT_OF_RANGE_COORDINATE"));
}

// ---------------------------------------------------------------------
// Test 6: partial dimension line rule — exactly one of
// lineStartPct/lineEndPct set (not both, not neither) is fatal.
// ---------------------------------------------------------------------
{
  const raw = baseValidEvidence();
  raw.dimensionEvidence[0].lineEndPct = null; // now start is set, end is null
  const result = validateEvidenceObservationVNext(raw);
  check("Test 6: one-sided dimension line is invalid", result.valid === false);
  check("Test 6: PARTIAL_DIMENSION_LINE reported", result.errors.some((e) => e.code === "PARTIAL_DIMENSION_LINE"));
}

// ---------------------------------------------------------------------
// Test 7: empty rawText is a diagnostic, not fatal — "unknown remains
// unknown" should not fail the whole artifact.
// ---------------------------------------------------------------------
{
  const raw = baseValidEvidence();
  raw.textLabels.push({ id: "l2", rawText: "", anchorImagePct: p(20, 20), roleHint: "uncertain" });
  const result = validateEvidenceObservationVNext(raw);
  check("Test 7: empty rawText does NOT invalidate the artifact", result.valid === true);
  check("Test 7: EMPTY_RAW_TEXT reported as diagnostic", result.diagnostics.some((d) => d.code === "EMPTY_RAW_TEXT"));
}

// ---------------------------------------------------------------------
// Test 8: honest empty output — zero dimensionEvidence and zero
// textLabels must be accepted as valid.
// ---------------------------------------------------------------------
{
  const raw = { schemaVersion: "evidence_observation_vnext_v1", dimensionEvidence: [], textLabels: [] };
  const result = validateEvidenceObservationVNext(parseEvidenceObservationVNext(raw));
  check("Test 8: empty evidence arrays are still valid", result.valid === true);
}

{
  const missing = baseValidEvidence();
  delete missing.dimensionEvidence[0].confidence;
  let missingRejected = false;
  try { parseEvidenceObservationVNext(missing); } catch { missingRejected = true; }
  check("Test 9: missing required Evidence property rejected", missingRejected);

  const extra = baseValidEvidence();
  extra.textLabels[0].unexpected = "not allowed";
  let extraRejected = false;
  try { parseEvidenceObservationVNext(extra); } catch { extraRejected = true; }
  check("Test 9b: additional Evidence property rejected", extraRejected);
}

{
  const raw = baseValidEvidence();
  raw.dimensionEvidence[0].id = "invalid id with spaces";
  let rejected = false;
  try { parseEvidenceObservationVNext(raw); } catch { rejected = true; }
  check("Test 10: invalid Evidence id shape rejected", rejected);
}

const summary = {
  testFileId: TEST_FILE_ID,
  assertionsPassed,
  assertionsFailed: failures,
  completed: true,
};
console.log("SHIFT_CHECKPOINT1_TEST_SUMMARY " + JSON.stringify(summary));
process.exit(failures === 0 ? 0 : 1);
