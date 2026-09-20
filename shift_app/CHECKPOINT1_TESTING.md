# Checkpoint 1 local verification

## Offline reproducible suite

No network access, credentials, Supabase connection, or OpenAI call is used by
this suite. From the package root, run:

```bash
./run_checkpoint1_tests.sh
```

The script deletes only its own generated `build/` directory, compiles the
TypeScript modules under `supabase/functions/_shared` with
`tsconfig.checkpoint1.json`, and runs all six test files. Generated
`build/*.js` files are disposable outputs and are not source-of-truth files.

Each test file emits exactly one machine-readable stdout line prefixed with
`SHIFT_CHECKPOINT1_TEST_SUMMARY `. Its JSON object contains a fixed
`testFileId`, `assertionsPassed`, `assertionsFailed`, and
`completed: true`. Per-file reviewed assertion locks are:

- Geometry: 105
- Evidence: 23
- Orchestration: 13
- Persistence: 61
- Prompts: 54
- Stability: 34

The harness validates each file independently: file presence, process exit
code, exactly one summary, no other stdout, exact test-file identity,
completion, zero failures, and the file's own expected assertion count. Only
after all six independent validations pass does it report the reviewed total
of `290`.

The Geometry contract covers exterior balconies, terraces, paving,
pergolas, canopies, and interior/exterior stairs without forcing exterior
features onto the wall graph. Wall-boundary paths and independent visible
image-space paths remain separate, support multiple fragments, and never
imply a missing connection or closure. `complete_visible` requires at least
one path and requires every path present in both boundary collections to be
explicitly closed on its own. A closed path beside any open fragment is
`partial_visible`, not `complete_visible`; closure is never shared or inferred
between wall paths and image-space paths. Stability compares an ID-independent
multiset of exterior feature type/evidence/completeness/enclosure values
and stairs context values in addition to entity counts.

`validate_checkpoint1_harness_protocol_mutations.mjs` exercises missing
files, non-zero exits, missing/duplicate/malformed summaries, wrong identities,
incomplete results, reported failures, low/high counts, forged `PASS:` lines
before or after a summary, and substitution of one file's summary for another.

This protocol is intended to prevent misleading output and regressions in the
test files. It is not a security boundary against malicious replacement of the
Node runtime or deliberate modification of the harness itself, and must not be
described as one.

Prompt SHA-256 locks are intentionally deferred. The canonical
`SHIFT_CHECKPOINT1_SOURCE_OF_TRUTH_2026-09-18.md` record and its full prompt
blocks are not present in this package, so the current strings must not be
promoted to canonical source-of-truth merely by hashing them. Semantic prompt
contract checks and mutation-based negative controls run without changing the
prompt strings themselves.

## Edge Function environment check

The Deno Edge Function is checked separately because its Supabase dependency is
a remote URL and therefore depends on the local Deno dependency cache:

```bash
DENO_NO_UPDATE_CHECK=1 deno check --cached-only \
  supabase/functions/analyze-sketch-vnext-checkpoint1/index.ts
```

`--cached-only` forbids dependency downloads. The command succeeds only when
the dependency and redirect metadata are already cached; a cache miss is an
environment limitation, not an offline-suite failure. This check is not counted
among the six offline test files or their assertions.
