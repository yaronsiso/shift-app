// PART G MIGRATION NOTE: thin re-export shim (Node-test-only mechanism,
// explicitly allowed by Part G design) pointing at this package's local
// flat mirror (src/_mirror/), which symlinks directly to the single
// physical source of truth under
// supabase/functions/_shared/phase1c/ -- see claude/00_HANDOFF Part G.
// No logic lives here.
export * from '../_mirror/parse_semantic_plan_proposal_response.ts';
