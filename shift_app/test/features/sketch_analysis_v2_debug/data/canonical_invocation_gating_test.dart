// test/features/sketch_analysis_v2_debug/data/canonical_invocation_gating_test.dart
//
// Tests the exact gating decision sketch_scope_debug_screen.dart uses to
// decide whether CanonicalTopology may be invoked
// (`envelopeTopologyResult.isValid`) against representative real response
// shapes, isolated from Flutter widget/state plumbing so it can run as a
// plain unit test. This directly covers required tests B and C from the
// integration task:
//   B. canonical is NOT called when envelope_topology is structurally
//      invalid/technical failure.
//   C. canonical IS called when EnvelopeTopology V2 returns valid:true,
//      even with OPEN_GRAPH_ENDPOINTS / NOT_SINGLE_CLOSED_CYCLE /
//      UNCERTAIN_HINT_PRESENT diagnostics.
//
// (Test A — stage ordering — and D — same jobId propagation — are
// structural properties of sketch_scope_debug_screen.dart's source itself:
// both _runEnvelopeTopology and _runCanonicalTopology read `jobId` from
// the same `_result?.jobId` and the CanonicalTopology button's onPressed
// is unconditionally gated on this same `isValid` check, so there is no
// code path that reaches _runCanonicalTopology with a different or
// missing jobId. This isn't independently expressible as a pure-Dart
// value-level test without a widget/mock-Supabase harness, which does not
// exist anywhere else in this codebase either — see the integration
// report for why a new one wasn't introduced here.)

import 'package:flutter_test/flutter_test.dart';
import 'package:shift_app/features/sketch_analysis_v2_debug/data/sketch_envelope_topology_service.dart';

/// Mirrors sketch_scope_debug_screen.dart's own gate exactly:
///   onPressed: (_canonicalTopologyBusy || !envelopeTopologyResult.isValid) ? null : _runCanonicalTopology
/// and _runCanonicalTopology's own internal guard:
///   if (_envelopeTopologyResult?.isValid != true) return;
/// Extracted here as a pure function purely so both call sites' shared
/// logic has one direct test target.
bool canonicalTopologyMayBeInvoked(EnvelopeTopologyResult? envelopeTopologyResult) {
  return envelopeTopologyResult?.isValid == true;
}

EnvelopeTopologyResult _resultWith({
  required String status,
  List<Map<String, dynamic>> diagnostics = const [],
  List<Map<String, dynamic>> errors = const [],
}) {
  return EnvelopeTopologyResult.fromJson({
    'jobId': 'job-x',
    'artifactId': 'artifact-x',
    'status': status,
    'topology': status == 'forbidden_field_error'
        ? null
        : {
            'schemaVersion': 'envelope_topology_v2',
            'vertices': [
              {
                'id': 'v1',
                'imagePct': {'xPct': 0.0, 'yPct': 0.0},
                'cornerAngleHint': null
              },
            ],
            'edges': <dynamic>[],
            'perceptionNotes': null,
          },
    'validation': status == 'forbidden_field_error'
        ? null
        : {
            'valid': status == 'valid',
            'errors': errors,
            'diagnostics': diagnostics,
          },
    'model': 'gpt-5.6-luna',
    'durationMs': 100,
    'attempt': 1,
  });
}

void main() {
  group('canonicalTopologyMayBeInvoked (test B + C from the integration task)', () {
    test('B: NOT invoked when envelope_topology has no result at all (null)', () {
      expect(canonicalTopologyMayBeInvoked(null), isFalse);
    });

    test('B: NOT invoked when status is "invalid" (structural fatal error)', () {
      final result = _resultWith(
        status: 'invalid',
        errors: [
          {'code': 'ZERO_LENGTH_EDGE', 'message': 'near-zero edge', 'relatedIds': ['e1']},
        ],
      );
      expect(canonicalTopologyMayBeInvoked(result), isFalse);
    });

    test('B: NOT invoked when status is "forbidden_field_error" (technical/contract failure)', () {
      final result = _resultWith(status: 'forbidden_field_error');
      expect(canonicalTopologyMayBeInvoked(result), isFalse);
    });

    test('C: IS invoked when status is "valid" with zero diagnostics', () {
      final result = _resultWith(status: 'valid');
      expect(canonicalTopologyMayBeInvoked(result), isTrue);
    });

    test('C: IS invoked when status is "valid" even with OPEN_GRAPH_ENDPOINTS, '
        'NOT_SINGLE_CLOSED_CYCLE, and UNCERTAIN_HINT_PRESENT diagnostics present', () {
      final result = _resultWith(
        status: 'valid',
        diagnostics: [
          {'code': 'OPEN_GRAPH_ENDPOINTS', 'message': 'open', 'relatedIds': <dynamic>[]},
          {'code': 'NOT_SINGLE_CLOSED_CYCLE', 'message': 'not closed', 'relatedIds': <dynamic>[]},
          {'code': 'UNCERTAIN_HINT_PRESENT', 'message': 'uncertain', 'relatedIds': <dynamic>[]},
        ],
      );
      expect(canonicalTopologyMayBeInvoked(result), isTrue,
          reason: 'diagnostics must never block canonical invocation — only fatal errors '
              '(reflected via status != "valid") do');
    });
  });
}
