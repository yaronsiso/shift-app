-- supabase/migrations/0007_analysis_jobs_v2.sql
--
-- ⚠️ NAMING NOTE (read before running): this project's committed
-- supabase/migrations/ folder is known to be missing files 0002-0006 (they
-- already ran successfully against the live database, but were never
-- copied into the repo — see claude/00_HANDOFF "לתעדף בהזדמנות"). Before
-- running this file, check `ls supabase/migrations/` yourself: if a file
-- named 0007_*.sql already exists there, just rename this file to the next
-- free number before adding it to the repo. The number in the filename is
-- for human bookkeeping only — running it is a manual copy-paste into the
-- Supabase SQL Editor (same as every migration in this project so far), so
-- the filename itself has no effect on whether it runs correctly.
--
-- What this adds: the DB side of the new staged sketch-analysis pipeline
-- (session 20, Stage 0 = "scope" only for now). Two new tables, modelled
-- directly on the existing `renders` table's proven RLS pattern (see
-- 0001_init.sql / 0002_credits_and_renders.sql) — auth.uid() = user_id,
-- select/insert allowed, no update/delete policy for the user (only the
-- service_role key, used inside the Edge Function, writes updates).
--
-- Does NOT touch: `renders`, `sketch_analyses`, or any existing table,
-- policy, function, or bucket. `analyze-sketch` (v15, production) and its
-- data are completely unaffected by this migration.

create table if not exists public.analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  original_image_path text not null,
  status text not null default 'processing'
    check (status in ('processing', 'stage_complete', 'failed')),
  current_stage text not null default 'scope',
  attempt integer not null default 1,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.analysis_jobs enable row level security;

create policy "Users can view their own analysis jobs"
  on public.analysis_jobs for select
  using (auth.uid() = user_id);

create policy "Users can insert their own analysis jobs"
  on public.analysis_jobs for insert
  with check (auth.uid() = user_id);

-- No update/delete policy for the client: the Edge Function updates job
-- status/stage/attempt using the service_role key, which bypasses RLS.
-- A user can read the progress of their own job, but only the server
-- advances it — same trust boundary as `renders.status`.

create table if not exists public.analysis_artifacts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.analysis_jobs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  stage text not null,
  version integer not null default 1,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.analysis_artifacts enable row level security;

create policy "Users can view their own analysis artifacts"
  on public.analysis_artifacts for select
  using (auth.uid() = user_id);

-- No insert/update/delete policy for the client: only the Edge Function
-- (service_role key) ever writes an artifact row. `user_id` is duplicated
-- here (denormalized from analysis_jobs.job_id) deliberately, matching
-- this project's existing preference for direct auth.uid()=user_id RLS
-- checks over a join through a parent table (see e.g. `renders`,
-- `sketch_analyses` — neither uses a join-based policy either).

create index if not exists analysis_jobs_user_id_idx
  on public.analysis_jobs (user_id, created_at desc);

create index if not exists analysis_artifacts_job_id_idx
  on public.analysis_artifacts (job_id, stage, version);
