#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "$0")" && pwd)"
cd "$script_dir"

build_link="$script_dir/build"
temp_build_dir=""
build_link_claimed=0

cleanup() {
  local status=$?
  local cleanup_failed=0
  local current_target=""

  trap - EXIT

  if [[ "$build_link_claimed" -eq 1 ]]; then
    if [[ -L "$build_link" ]]; then
      current_target="$(readlink -- "$build_link")"
    fi

    if [[ -L "$build_link" && "$current_target" == "$temp_build_dir" ]]; then
      if ! rm -- "$build_link"; then
        echo "Cleanup failure: could not remove the owned build symlink" >&2
        cleanup_failed=1
      fi
    else
      echo "Cleanup boundary failure: build is not the symlink owned by this harness run" >&2
      cleanup_failed=1
    fi
  fi

  if [[ -n "$temp_build_dir" ]]; then
    case "$temp_build_dir" in
      /tmp/shift-checkpoint1-build-*)
        if [[ -d "$temp_build_dir" && ! -L "$temp_build_dir" ]]; then
          if ! rm -rf -- "$temp_build_dir"; then
            echo "Cleanup failure: could not remove this run's temporary build directory" >&2
            cleanup_failed=1
          fi
        elif [[ -e "$temp_build_dir" || -L "$temp_build_dir" ]]; then
          echo "Cleanup boundary failure: temporary build path changed type" >&2
          cleanup_failed=1
        fi
        ;;
      *)
        echo "Cleanup boundary failure: refusing unexpected temporary build path" >&2
        cleanup_failed=1
        ;;
    esac
  fi

  if [[ "$cleanup_failed" -ne 0 ]]; then
    exit 1
  fi
  exit "$status"
}
trap cleanup EXIT

if [[ "$script_dir" == "/" || "$build_link" != "$script_dir/build" ]]; then
  echo "Refusing an invalid workspace build path" >&2
  exit 2
fi

if [[ -e "$build_link" || -L "$build_link" ]]; then
  echo "Refusing to start: workspace build already exists" >&2
  exit 2
fi

if ! command -v tsc >/dev/null 2>&1; then
  echo "TypeScript compiler not found: this harness requires 'tsc' to be available on PATH" >&2
  exit 2
fi

temp_build_dir="$(mktemp -d /tmp/shift-checkpoint1-build-XXXXXXXXXX)"
tsc -p tsconfig.checkpoint1.json --outDir "$temp_build_dir"

if [[ -e "$build_link" || -L "$build_link" ]]; then
  echo "Refusing to acquire workspace build: it appeared during compilation" >&2
  exit 2
fi

# Mark cleanup as ownership-aware before the atomic name acquisition. If a
# competing path wins, cleanup will observe the mismatch and leave it alone.
build_link_claimed=1
if ! ln --symbolic --no-target-directory -- "$temp_build_dir" "$build_link"; then
  echo "Failed to acquire workspace build symlink" >&2
  exit 2
fi

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
expected_mutation_output='SHIFT_CHECKPOINT1_HARNESS_MUTATION_SUMMARY {"mutationsPassed":28,"mutationsFailed":0,"completed":true}'

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
echo "ATOMIC_ACQUISITION_HARNESS_MUTATIONS=1"
echo "HARNESS_PROTOCOL_MUTATIONS=28"

atomic_test_file="validate_analysis_artifact_atomic_versioning_test.mjs"
atomic_test_file_id="atomic_versioning"
expected_atomic_assertions=168
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
