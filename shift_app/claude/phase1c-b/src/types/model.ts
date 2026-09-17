// claude/phase1c-b/src/types/model.ts
//
// PART G MIGRATION NOTE: thin re-export shim (Node-test-only mechanism,
// explicitly allowed by Part G design) pointing at the single physical
// source of truth via this package's local flat mirror (src/_mirror/),
// which in turn symlinks directly to
// supabase/functions/_shared/phase1c/model.ts. No logic lives here -- see
// claude/00_HANDOFF Part G.
export * from '../_mirror/model.ts';
