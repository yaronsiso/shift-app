#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
cd "$script_dir"

build_dir="$script_dir/build"
if [[ "$script_dir" == "/" || "$build_dir" != "$script_dir/build" ]]; then
  echo "Refusing to clean a build directory outside the package root" >&2
  exit 2
fi

if ! command -v tsc >/dev/null 2>&1; then
  echo "TypeScript compiler not found: this harness requires 'tsc' to be available on PATH" >&2
  exit 2
fi

rm -rf -- "$build_dir"
tsc --project tsconfig.checkpoint1.json

test_files=(
  validate_geometry_observation_vnext_test.mjs
  validate_evidence_observation_vnext_test.mjs
  validate_vnext_orchestration_test.mjs
  validate_vnext_persistence_payload_test.mjs
  validate_vnext_prompt_locks_test.mjs
  validate_vnext_stability_utility_test.mjs
)
test_file_ids=(
  geometry
  evidence
  orchestration
  persistence
  prompts
  stability
)
expected_assertions_by_file=(
  105
  23
  13
  61
  54
  34
)
expected_total_assertions=290
expected_mutation_output='SHIFT_CHECKPOINT1_HARNESS_MUTATION_SUMMARY {"mutationsPassed":27,"mutationsFailed":0,"completed":true}'

set +e
mutation_output="$(node validate_checkpoint1_harness_protocol_mutations.mjs 2>&1)"
mutation_status=$?
set -e
if [[ "$mutation_status" -ne 0 || "$mutation_output" != "$expected_mutation_output" ]]; then
  echo "Harness protocol mutation suite failed" >&2
  printf '%s\n' "$mutation_output" >&2
  exit 1
fi
echo "$mutation_output"

validated_files=0
total_assertions=0
for index in "${!test_files[@]}"
do
  test_file="${test_files[$index]}"
  test_file_id="${test_file_ids[$index]}"
  expected_assertions="${expected_assertions_by_file[$index]}"
  expected_runner_output="SHIFT_CHECKPOINT1_VALIDATED_FILE {\"testFileId\":\"${test_file_id}\",\"assertionsPassed\":${expected_assertions},\"assertionsFailed\":0,\"completed\":true}"

  set +e
  runner_output="$(node checkpoint1_test_protocol.mjs "$test_file" "$test_file_id" "$expected_assertions" 2>&1)"
  runner_status=$?
  set -e

  if [[ "$runner_status" -ne 0 || "$runner_output" != "$expected_runner_output" ]]; then
    echo "Test protocol validation failed for $test_file" >&2
    printf '%s\n' "$runner_output" >&2
    exit 1
  fi

  echo "$runner_output"
  validated_files=$((validated_files + 1))
  total_assertions=$((total_assertions + expected_assertions))
done

if [[ "$validated_files" -ne 6 ]]; then
  echo "Expected 6 validated test files, got $validated_files" >&2
  exit 1
fi
if [[ "$total_assertions" -ne "$expected_total_assertions" ]]; then
  echo "Expected $expected_total_assertions total assertions, got $total_assertions" >&2
  exit 1
fi

echo "TEST_FILES_VALIDATED=$validated_files"
echo "ASSERTIONS_VALIDATED=$total_assertions"
echo "EXPECTED_ASSERTIONS=$expected_total_assertions"
echo "ORIGINAL_HARNESS_PROTOCOL_MUTATIONS=15"
echo "ATOMIC_HARNESS_PROTOCOL_MUTATIONS=12"
echo "HARNESS_PROTOCOL_MUTATIONS=27"

atomic_test_file="validate_analysis_artifact_atomic_versioning_test.mjs"
atomic_test_file_id="atomic_versioning"
expected_atomic_assertions=153
expected_atomic_runner_output="SHIFT_CHECKPOINT1_VALIDATED_FILE {\"testFileId\":\"${atomic_test_file_id}\",\"assertionsPassed\":${expected_atomic_assertions},\"assertionsFailed\":0,\"completed\":true}"
set +e
atomic_runner_output="$(node checkpoint1_test_protocol.mjs "$atomic_test_file" "$atomic_test_file_id" "$expected_atomic_assertions" 2>&1)"
atomic_runner_status=$?
set -e
if [[ "$atomic_runner_status" -ne 0 || "$atomic_runner_output" != "$expected_atomic_runner_output" ]]; then
  echo "Atomic versioning test protocol validation failed" >&2
  printf '%s\n' "$atomic_runner_output" >&2
  exit 1
fi
echo "$atomic_runner_output"
echo "ATOMIC_VERSIONING_ASSERTIONS=$expected_atomic_assertions"
