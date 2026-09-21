# Open blocker: atomic artifact versioning is not production-ready

The Checkpoint 1 RPC path exists in code. It calls
`insert_analysis_artifact_atomic`, which locks the parent `analysis_jobs`
row, allocates the next stage version, inserts one immutable artifact, and
sets `payload.attempt` from the database-assigned version in the same
transaction. The RPC rejects NULL, empty, whitespace, and every stage other
than the exact value `vnext_checkpoint1`.

Migration `0008_analysis_artifact_atomic_versioning.sql` now validates an
existing `analysis_artifacts_vnext_checkpoint1_version_uidx` structurally
through PostgreSQL catalogs. It accepts only a valid, ready
partial UNIQUE index on exactly
`public.analysis_artifacts(job_id, stage, version)`, in that order, with no
expression or included columns and with `pg_get_expr` returning the exact
canonical predicate `(stage = 'vnext_checkpoint1'::text)`. No global character
normalization is performed, so whitespace, parentheses, missing characters,
extra characters, OR/IN expressions, or any other change inside the literal or
predicate is rejected. A same-name object with any other definition aborts the
transaction before the RPC is created; it is never dropped or rewritten.
Duplicate preflight is likewise limited to `vnext_checkpoint1`.

No global uniqueness constraint is added. Existing legacy indexes,
constraints, data, and all six direct writers remain unchanged and are outside
the partial index predicate.

After `CREATE OR REPLACE FUNCTION`, the migration enumerates the function ACL,
removes every explicit non-owner EXECUTE grant (including PUBLIC and historical
custom roles), and grants EXECUTE to the owner and `service_role`. This does not prove that
the target environment's role-membership graph cannot confer inherited access;
that requires a real PostgreSQL/Supabase permissions review before apply.

The migration takes `SHARE ROW EXCLUSIVE` and creates the unique index
non-concurrently. It may block all writes to `analysis_artifacts` until commit.
Apply therefore requires a maintenance window or documented lock-impact
assessment, an explicitly selected timeout policy, production preflight, and a
successful real-PostgreSQL migration test. This patch selects no timeout.

This is still an open production gate:

- PostgreSQL has not executed or compiled migrations 0007/0008 in this review
  environment.
- Production duplicates and production constraint metadata are unknown.
- Migration 0008 has not been applied.
- No Edge Function has been deployed.
- A production preflight and independent review are still required before any
  migration apply or deployment.
- Migration 0008 must be applied and verified successfully before the updated
  Checkpoint 1 Edge Function is deployed; the reverse order is forbidden.

## Existing direct-writer analysis

Every writer below can be invoked twice for the same job/stage. None catches
and retries SQLSTATE 23505 specifically. Their response-driving inserts select
only `id`, not the database's stored `version` or `payload`; canonical's
best-effort diagnostic insert does not request a returned row at all.

| Writer | Allocation and local use | Returned/downstream contract | Trigger or unique-conflict effect | Future targeted retry |
| --- | --- | --- | --- | --- |
| `analyze-sketch-v2-scope` | New jobs use attempt 1; retries read `analysis_jobs.attempt`, add one, update the job, then use that value for row version, payload attempt, and response attempt. | Returns local attempt. PageDimensions reads the newest scope artifact by DB version. | A trigger-rewritten version would disagree with job attempt, payload attempt unless also rewritten, and HTTP response. A uniqueness error fails persistence, marks the job failed, and returns 500. | Possible only with explicit reconciliation of job attempt, persisted payload, and returned DB version; not a transparent insert retry. |
| `analyze-sketch-v2-page-dimensions` | Reads latest stage version and computes `max+1`; uses it in row, payload, and response. | Returns local attempt. Envelope consumes the newest page_dimensions artifact. | A trigger can make the response and payload disagree with the row/order used downstream. A uniqueness error logs/fails the job and returns 500. | Mechanically possible around persistence if the DB returns the assigned version and the payload/response are rebuilt; requires a code change. |
| `analyze-sketch-v2-measurements` | Reads latest measurements version and computes `max+1`; uses it in row, payload, and response. | Returns local attempt. The current envelope path no longer depends on this older stage, but the debug service can invoke it. | Trigger rewriting makes row, payload, and response diverge. A uniqueness error marks the job failed and returns 500. | Possible with the same explicit DB-returned-version conversion; requires a code change. |
| `analyze-sketch-v2-envelope` | Reads latest envelope version and computes `max+1`; both blocked and successful branches persist and return the local attempt. | Returns local attempt. It is consumed by its debug/client path; current envelope-topology/canonical flow does not use it as its version source. | Trigger rewriting makes the row disagree with payload and either response branch. A uniqueness error marks the job failed and returns 500. | Possible, but both persistence branches must share one atomic helper and use its returned version. |
| `analyze-sketch-v2-envelope-topology` | Reads latest stage version and computes `max+1`; embeds it in every payload outcome and spreads that payload into the response. | CanonicalTopology orders artifacts by DB version and selects a compatible newest valid artifact. | A trigger-rewritten row can disagree with payload/response and change downstream ordering. A uniqueness error returns 500; this legacy path also includes raw DB detail in its own error handling. | Possible with an atomic RPC and response finalization from the returned version; requires a code change. |
| `analyze-sketch-v2-canonical-topology` | Computes one shared attempt as one plus the maximum across `semantic_plan` and `canonical_topology`; uses it in prompts/IDs, one or two rows, payloads, and response. | Returns local attempt and artifact IDs. Canonical artifacts are authoritative downstream data. | A generic per-stage trigger may assign different versions to the paired rows, break their shared-attempt contract, and leave a semantic row committed if the later canonical insert conflicts. | A naive insert retry is unsafe after partial persistence. Conversion needs one transaction/RPC that preserves the two-stage shared-attempt semantics. |

## Strategy decision

1. **Checkpoint 1-only partial UNIQUE index:** selected. It protects
   `(job_id, stage, version)` only when `stage = 'vnext_checkpoint1'` and
   does not change legacy-stage insert behavior.
2. **Checkpoint 1-only RPC:** selected. It rejects every other stage before
   locking or allocation, owns `payload.attempt`, and has no direct-insert
   fallback.
3. **Global constraint, trigger, or legacy-writer conversion:** outside this
   change. None is created or implemented here.

Migration 0008 remains unapplied. The Checkpoint 1 code must not be described
as production-deployable until independent review, production preflight, and
real PostgreSQL verification of syntax, catalogs, locking, permissions, RLS,
and rollback behavior are complete.
