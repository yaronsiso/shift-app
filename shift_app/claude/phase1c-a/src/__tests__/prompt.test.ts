import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SEMANTIC_PLAN_SYSTEM_PROMPT_V1 } from '../prompt/semantic_plan_system_prompt_v1.js';

// This file proves, by substring, that every rule the user required in the
// approved Part B design is actually present in the prompt text that ships.
// It is intentionally a "does the prompt say X" regression guard, not a
// judgment on prompt quality -- if any of these substrings ever disappears
// during a future edit, this test catches it immediately. Every substring
// below is verified to sit within a single line of the source template
// literal (no accidental dependency on line-wrap whitespace).

function assertContains(needle: string, label: string): void {
  assert.ok(SEMANTIC_PLAN_SYSTEM_PROMPT_V1.includes(needle), `prompt missing required content (${label}): "${needle}"`);
}

test('prompt contains the complete-edge-coverage rule', () => {
  assertContains('כיסוי מלא חובה', 'complete edge coverage');
  assertContains('לא פחות, לא יותר', 'exactly-one-per-edge phrasing');
});

test('prompt contains the UNRESOLVED fallback for undecidable edges/vertices', () => {
  assertContains('disposition="UNRESOLVED"', 'edge UNRESOLVED fallback');
  assertContains('finding="UNRESOLVED"', 'vertex UNRESOLVED fallback');
});

test('prompt explicitly distinguishes sparse vertices from complete edges', () => {
  assertContains('sparse בכוונה', 'vertexProposals sparse-by-design wording');
  assertContains('NOT_AUDITED', 'vertex absence = NOT_AUDITED');
});

test('prompt contains the inner-face canonical-boundary rule', () => {
  assertContains('הפאה הפנימית', 'inner-face rule');
  assertContains('inner face', 'inner-face rule (bilingual anchor)');
});

test('prompt contains the local-adjacency-over-connectivity rule', () => {
  assertContains('צמידות מקומית פנים↔חוץ', 'local adjacency rule');
  assertContains('local interior↔exterior', 'local adjacency rule (bilingual anchor)');
  assertContains('אינו הוכחה לנכונות סמנטית', 'connectivity-is-not-proof rule');
});

test('prompt contains opening-specific safeguards (roleHint mentioned as a hint + opening graphics excluded)', () => {
  assertContains('roleHint', 'roleHint mentioned');
  assertContains('כנף דלת', 'opening graphics example (door leaf)');
  assertContains('אסור להמציא edge חדש כדי לגשר על פתח', 'no invented bridging edge for openings');
  assertContains('רק בגלל שהוא נמצא בקיר חוץ', 'opening graphics not promoted merely for wall location');
});

test('prompt contains the dual-face handling rule (existence proposed, not proof)', () => {
  assertContains('REJECT_DUAL_FACE', 'dual-face disposition');
  assertContains('dualFaceOf', 'dualFaceOf field mention');
  assertContains('אינו הוכחה סופית', 'dual-face existence-not-proof wording');
});

test('prompt contains the terrace/pergola/open-balcony/exterior-stairs exclusion rule', () => {
  assertContains('מרפסת פתוחה', 'open balcony');
  assertContains('פרגולה', 'pergola');
  assertContains('מדרגות', 'exterior stairs');
  assertContains('טרסה חשופה', 'uncovered terrace');
  assertContains('REJECT_NOT_ENVELOPE', 'exclusion disposition');
});

test('prompt contains the SPLIT_REQUIRED rule for a role-changing wall', () => {
  assertContains('SPLIT_REQUIRED', 'SPLIT_REQUIRED disposition');
});

test('prompt contains no-forced-closure and no-proximity-only-repair rules', () => {
  assertContains('סגירה כפויה', 'no forced closure');
  assertContains('קרבה גיאומטרית בלבד', 'no proximity-only repair');
});

test('prompt forbids topology mutation, canonical IDs, and metric geometry', () => {
  assertContains('canonicalVertexId', 'forbidden canonical id (vertex)');
  assertContains('canonicalEdgeId', 'forbidden canonical id (edge)');
  assertContains('isFullyClosed', 'forbidden candidate-layer flag');
  assertContains('executionAllowed', 'forbidden plan-layer flag');
  assertContains('topology', 'topology mutation phrasing present');
  assertContains('שום קואורדינטה, מרחק, קנה מידה, שטח', 'no metric geometry rule');
});
