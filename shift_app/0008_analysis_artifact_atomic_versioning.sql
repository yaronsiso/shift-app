-- Atomic version allocation for Checkpoint 1 artifacts only.
--
-- This migration deliberately leaves every legacy stage, index, constraint,
-- and writer unchanged. It fails without repairing data or replacing schema
-- objects when Checkpoint 1 duplicates or a same-name index collision exist.

begin;

-- Close the preflight-to-index race while the Checkpoint 1-only index is
-- inspected or created. No artifact data is rewritten or removed.
lock table public.analysis_artifacts in share row exclusive mode;

do $migration$
declare
  v_index_oid oid;
  v_object_kind "char";
  v_table_schema text;
  v_table_name text;
  v_index_unique boolean;
  v_index_valid boolean;
  v_index_ready boolean;
  v_key_attribute_count integer;
  v_total_attribute_count integer;
  v_index_expressions pg_node_tree;
  v_index_columns text[];
  v_index_predicate text;
begin
  if exists (
    select 1
    from public.analysis_artifacts
    where stage = 'vnext_checkpoint1'
    group by job_id, stage, version
    having count(*) > 1
  ) then
    raise exception using
      errcode = '23505',
      message = 'analysis_artifacts contains duplicate vnext_checkpoint1 versions',
      detail = 'Atomic versioning migration stopped without changing artifact data.',
      hint = 'Audit and remediate Checkpoint 1 duplicates explicitly, then rerun this migration.';
  end if;

  select
    index_objects.oid,
    index_objects.relkind,
    table_namespaces.nspname,
    tables.relname,
    indexes.indisunique,
    indexes.indisvalid,
    indexes.indisready,
    indexes.indnkeyatts,
    indexes.indnatts,
    indexes.indexprs,
    array(
      select attributes.attname::text
      from unnest(indexes.indkey) with ordinality as keys(attnum, position)
      join pg_catalog.pg_attribute as attributes
        on attributes.attrelid = indexes.indrelid
       and attributes.attnum = keys.attnum
      where keys.position <= indexes.indnkeyatts
      order by keys.position
    ),
    pg_catalog.pg_get_expr(indexes.indpred, indexes.indrelid, false)
  into
    v_index_oid,
    v_object_kind,
    v_table_schema,
    v_table_name,
    v_index_unique,
    v_index_valid,
    v_index_ready,
    v_key_attribute_count,
    v_total_attribute_count,
    v_index_expressions,
    v_index_columns,
    v_index_predicate
  from pg_catalog.pg_class as index_objects
  join pg_catalog.pg_namespace as index_namespaces
    on index_namespaces.oid = index_objects.relnamespace
  left join pg_catalog.pg_index as indexes
    on indexes.indexrelid = index_objects.oid
  left join pg_catalog.pg_class as tables
    on tables.oid = indexes.indrelid
  left join pg_catalog.pg_namespace as table_namespaces
    on table_namespaces.oid = tables.relnamespace
  where index_namespaces.nspname = 'public'
    and index_objects.relname = 'analysis_artifacts_vnext_checkpoint1_version_uidx';

  if v_index_oid is not null then
    if v_object_kind is distinct from 'i'
      or v_table_schema is distinct from 'public'
      or v_table_name is distinct from 'analysis_artifacts'
      or v_index_unique is distinct from true
      or v_index_valid is distinct from true
      or v_index_ready is distinct from true
      or v_key_attribute_count is distinct from 3
      or v_total_attribute_count is distinct from 3
      or v_index_expressions is not null
      or v_index_columns is distinct from array['job_id', 'stage', 'version']::text[]
      -- Compare pg_get_expr's canonical rendering without deleting or
      -- rewriting any character. In particular, whitespace and parentheses
      -- inside the string literal remain semantically significant.
      or v_index_predicate is distinct from
        '(stage = ''vnext_checkpoint1''::text)'
    then
      raise exception using
        errcode = '42P16',
        message = 'analysis_artifacts_vnext_checkpoint1_version_uidx has an unexpected definition',
        detail = 'Expected a valid, ready partial UNIQUE index on public.analysis_artifacts (job_id, stage, version) WHERE stage = ''vnext_checkpoint1'', with no expressions or included columns.',
        hint = 'Do not drop or replace the existing object automatically; audit the name collision and resolve it explicitly.';
    end if;
  else
    create unique index analysis_artifacts_vnext_checkpoint1_version_uidx
      on public.analysis_artifacts (job_id, stage, version)
      where stage = 'vnext_checkpoint1';
  end if;
end
$migration$;

create or replace function public.insert_analysis_artifact_atomic(
  p_job_id uuid,
  p_user_id uuid,
  p_stage text,
  p_payload jsonb
)
returns table (
  artifact_id uuid,
  artifact_version integer
)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_job_user_id uuid;
  v_version integer;
  v_artifact_id uuid;
  v_retry_count integer := 0;
  v_constraint_name text;
begin
  if p_job_id is null or p_user_id is null then
    raise exception using
      errcode = '22023',
      message = 'job and user identifiers are required';
  end if;

  -- NULL, empty strings, whitespace, and every legacy stage fail here.
  if p_stage is distinct from 'vnext_checkpoint1' then
    raise exception using
      errcode = '22023',
      message = 'artifact stage must be vnext_checkpoint1';
  end if;

  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception using
      errcode = '22023',
      message = 'artifact payload must be a JSON object';
  end if;

  -- The database owns version allocation. Reject a caller-supplied attempt
  -- rather than silently accepting a value that may disagree with version.
  if p_payload ? 'attempt' then
    raise exception using
      errcode = '22023',
      message = 'artifact payload attempt is database-assigned';
  end if;

  -- The parent row is a collision-free, transaction-scoped lock. Calls for
  -- the same job serialize until commit; calls for different jobs proceed in
  -- parallel. The owner check also prevents a mismatched denormalized user_id.
  select jobs.user_id
    into v_job_user_id
    from public.analysis_jobs as jobs
    where jobs.id = p_job_id
    for update;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'analysis job does not exist';
  end if;

  if v_job_user_id <> p_user_id then
    raise exception using
      errcode = '23514',
      message = 'artifact user does not own analysis job';
  end if;

  loop
    select coalesce(max(artifacts.version), 0) + 1
      into v_version
      from public.analysis_artifacts as artifacts
      where artifacts.job_id = p_job_id
        and artifacts.stage = 'vnext_checkpoint1';

    begin
      insert into public.analysis_artifacts (
        job_id,
        user_id,
        stage,
        version,
        payload
      ) values (
        p_job_id,
        p_user_id,
        'vnext_checkpoint1',
        v_version,
        p_payload || jsonb_build_object('attempt', v_version)
      )
      returning id into v_artifact_id;

      return query select v_artifact_id, v_version;
      return;
    exception
      when unique_violation then
        get stacked diagnostics v_constraint_name = constraint_name;

        -- Only this Checkpoint 1 partial index is retryable. Any unrelated
        -- uniqueness failure retains its original database semantics.
        if v_constraint_name is distinct from
          'analysis_artifacts_vnext_checkpoint1_version_uidx'
        then
          raise;
        end if;

        v_retry_count := v_retry_count + 1;
        if v_retry_count >= 3 then
          raise;
        end if;
        -- A competing Checkpoint 1 insert that bypasses this RPC is still
        -- caught by the partial index; the next loop recomputes the maximum.
    end;
  end loop;
end
$function$;

-- CREATE OR REPLACE preserves an existing function's ACL. Remove every
-- explicit EXECUTE grant except the owner's required authority, including
-- PUBLIC and historical custom-role grants, before granting the owner and
-- service role back explicitly. Inherited role membership still requires
-- environment-specific PostgreSQL/Supabase verification before apply.
do $permissions$
declare
  v_function_oid oid :=
    'public.insert_analysis_artifact_atomic(uuid,uuid,text,jsonb)'::pg_catalog.regprocedure;
  v_execute_grant record;
  v_function_owner name;
begin
  select pg_catalog.pg_get_userbyid(functions.proowner)
    into v_function_owner
    from pg_catalog.pg_proc as functions
    where functions.oid = v_function_oid;

  for v_execute_grant in
    select distinct
      expanded_acl.grantee,
      pg_catalog.pg_get_userbyid(expanded_acl.grantee) as grantee_name
    from pg_catalog.pg_proc as functions
    cross join lateral pg_catalog.aclexplode(
      coalesce(functions.proacl, pg_catalog.acldefault('f', functions.proowner))
    ) as expanded_acl
    where functions.oid = v_function_oid
      and expanded_acl.privilege_type = 'EXECUTE'
      and expanded_acl.grantee is distinct from functions.proowner
  loop
    if v_execute_grant.grantee = 0 then
      execute
        'revoke execute on function public.insert_analysis_artifact_atomic(uuid, uuid, text, jsonb) from public';
    else
      execute pg_catalog.format(
        'revoke execute on function public.insert_analysis_artifact_atomic(uuid, uuid, text, jsonb) from %I',
        v_execute_grant.grantee_name
      );
    end if;
  end loop;

  execute pg_catalog.format(
    'grant execute on function public.insert_analysis_artifact_atomic(uuid, uuid, text, jsonb) to %I',
    v_function_owner
  );
end
$permissions$;

grant execute on function public.insert_analysis_artifact_atomic(uuid, uuid, text, jsonb)
  to service_role;

comment on function public.insert_analysis_artifact_atomic(uuid, uuid, text, jsonb) is
  'Atomically inserts vnext_checkpoint1 with its next version; explicit EXECUTE grants are limited to service_role and the function owner; inherited privileges require environment review.';

commit;
