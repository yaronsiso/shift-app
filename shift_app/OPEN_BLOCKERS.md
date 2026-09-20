# Open blocker: atomic artifact version allocation

Checkpoint 1 currently reads the highest `analysis_artifacts.version` and then
inserts `version + 1`. Concurrent invocations can therefore select the same
version.

The table definition is present in:
`/workspaces/shift-app/shift_app/0007_analysis_jobs_v2.sql`.
It defines a non-unique index, but no unique constraint covering
`(job_id, stage, version)`. Consequently, two concurrent invocations can both
read the same maximum and both successfully insert the same next version.

Exact classification:

- This does not block imports.
- This does not block the build or local tests.
- This blocks a normal deployment in which concurrent invocations are possible.
- A manual pilot is temporarily viable only when invocations are guaranteed to
  be completely serial.
- The application code does not provide or enforce that serialization.


Safe alternatives for an explicitly authorized later checkpoint:

1. Add/confirm a unique constraint on `(job_id, stage, version)`, then use a
   bounded retry on unique-conflict.
2. Add a database RPC that allocates and inserts the next version while holding
   an advisory or row lock.
3. Use a database-generated monotonic attempt identifier if sequential
   per-stage version numbers are not a hard API requirement.

No attempt was made to simulate atomicity in application code.
