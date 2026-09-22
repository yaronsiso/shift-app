# Checkpoint 1 local verification

## Offline reproducible suite

No network access, credentials, Supabase connection, or OpenAI call is used by
this suite. From the package root, run:

```bash
./run_checkpoint1_tests.sh
```

The harness does not install dependencies or create a lockfile. It requires a
working `tsc` command to be available on `PATH` and fails with an explicit
message before deleting or compiling anything when that command is absent.

The script refuses to start if workspace `build` already exists. It creates a
unique `/tmp/shift-checkpoint1-build-*` directory, compiles the TypeScript
modules under `supabase/functions/_shared` directly into it with
`tsconfig.checkpoint1.json`, and then atomically acquires the workspace name
`build` as a symlink to that directory. Acquisition uses GNU `ln` with
`--no-target-directory`, so an existing file, directory, or symlink named
`build` makes acquisition fail instead of creating an entry inside an external
directory. There is no unprotected `ln -s` fallback. It runs all six original
reviewed test files plus the focused atomic-versioning file through the same
strict summary protocol. On every exit it removes the symlink only when it is
still the exact link owned by that run, and removes only that run's temporary
directory. A pre-existing, concurrently created, or replacement `build` is
never removed or modified; an ownership mismatch is reported as a
cleanup-boundary failure. Generated files in the temporary build are
disposable outputs and are not source-of-truth files.

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
after all six original independent validations pass does it report their
unchanged reviewed total of `290`. It then validates
`validate_analysis_artifact_atomic_versioning_test.mjs` with the fixed
`testFileId` `atomic_versioning` and exactly 168 assertions. That suite covers
the Checkpoint 1-only partial unique index and exact predicate, catalog
structure and name collisions, scoped duplicate preflight, RPC stage
rejection, locking, bounded retry, grants, canonical UUID response validation,
the unchanged legacy writers, handler source locks, isolated temporary build
bootstrap ownership, the exact transaction-local timeout policy, and explicitly
limited logical models.

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

`validate_checkpoint1_harness_protocol_mutations.mjs` retains all 15 original
protocol mutations and 12 atomic-suite mutations: missing/duplicate summary,
wrong identity, incomplete result, reported failures, low/high counts, forged
stdout before/after, invalid JSON, and missing/additional fields. One additional
atomic-acquisition mutation replaces `--no-target-directory` with unprotected
`ln -s` and requires that mutated harness source to be rejected. The harness
therefore requires 28/28 mutations while still reporting the original 15,
atomic 12, and atomic-acquisition 1 separately.

Migration `0008_analysis_artifact_atomic_versioning.sql` is validated statically
by the focused suite. It is not applied to any database by this harness. The
migration takes a write-conflicting table lock, aborts only on duplicate
`vnext_checkpoint1` keys, and structurally validates any same-name index
through `pg_class`, `pg_index`, `pg_attribute`, and the exact canonical output
of `pg_get_expr` before creating the RPC. It requires exactly
`(job_id, stage, version)`, no expression or included columns, and the exact
predicate `stage = 'vnext_checkpoint1'`; it never strips whitespace or
parentheses from the rendered expression. The permission step enumerates the
function ACL, removes explicit EXECUTE grants from PUBLIC and every non-owner
role, and then grants EXECUTE to the function owner and `service_role`. Inherited role membership and
the PostgreSQL/Supabase role graph still require environment-specific review.

The migration deliberately uses `SHARE ROW EXCLUSIVE` followed by a
non-concurrent `CREATE UNIQUE INDEX`. It can block writes to the entire
`analysis_artifacts` table until commit. Before any apply, operators must use a
maintenance window or perform a documented lock-impact assessment, select an
appropriate timeout policy, run production preflight, and verify the migration
on real PostgreSQL. Migration 0008 sets `lock_timeout='2s'` and
`statement_timeout='30s'` with `SET LOCAL` immediately after `BEGIN`, so both
settings apply only to the migration transaction and are active before its
table lock, duplicate preflight, or DDL.

The JavaScript metadata and concurrency models test decision contracts only;
they are explicitly not proof of PostgreSQL syntax, catalog behavior, locking,
RLS, permissions, role inheritance, or rollback. No test repairs, deletes,
renumbers, or silently replaces existing data/schema.

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
