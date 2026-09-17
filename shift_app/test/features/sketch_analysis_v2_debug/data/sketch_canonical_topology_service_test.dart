// test/features/sketch_analysis_v2_debug/data/sketch_canonical_topology_service_test.dart
//
// Focused, pure-Dart tests for CanonicalTopologyResult's JSON parsing and
// its isSuccess/isBlocked distinction — the exact mechanism
// sketch_scope_debug_screen.dart uses to decide whether a
// SEMANTIC_BLOCKED response should ever be shown as an error (it must
// not) versus an actual technical failure (CanonicalTopologyFailure,
// tested separately below), which must be.

import 'package:flutter_test/flutter_test.dart';
import 'package:shift_app/features/sketch_analysis_v2_debug/data/sketch_canonical_topology_service.dart';

void main() {
  group('CanonicalTopologyResult.fromJson / isSuccess / isBlocked', () {
    test('status:"success" parses correctly, isSuccess true, isBlocked false', () {
      final json = {
        'jobId': 'job-1',
        'semanticPlanArtifactId': 'sp-1',
        'canonicalTopologyArtifactId': 'ct-1',
        'status': 'success',
        'candidateState': 'CLOSED_SINGLE_LOOP',
        'sourceEnvelopeTopologyArtifactVersion': 3,
        'sourceEnvelopeTopologyArtifactSchemaVersion': 'envelope_topology_v2',
        'skippedNewerInvalidVersions': <dynamic>[],
        'skippedUnsupportedSchemaVersions': <dynamic>[],
        'durationMs': 2200,
        'attempt': 1,
      };

      final result = CanonicalTopologyResult.fromJson(json);

      expect(result.status, 'success');
      expect(result.isSuccess, isTrue);
      expect(result.isBlocked, isFalse);
      expect(result.candidateState, 'CLOSED_SINGLE_LOOP');
      expect(result.canonicalTopologyArtifactId, 'ct-1');
      expect(result.blockedReasons, isEmpty);
    });

    test('status:"blocked" parses correctly with blockedReasons, '
        'isBlocked true, isSuccess false — this must NEVER be treated as '
        'a technical failure by the caller', () {
      final json = {
        'jobId': 'job-2',
        'status': 'blocked',
        'blockedReasons': [
          'e6: SPLIT_REQUIRED — constructor cannot execute this edge role yet',
        ],
        'sourceEnvelopeTopologyArtifactVersion': 2,
        'sourceEnvelopeTopologyArtifactSchemaVersion': 'envelope_topology_v2',
        'skippedNewerInvalidVersions': <dynamic>[],
        'skippedUnsupportedSchemaVersions': <dynamic>[],
        'durationMs': 1800,
        'attempt': 4,
      };

      final result = CanonicalTopologyResult.fromJson(json);

      expect(result.status, 'blocked');
      expect(result.isBlocked, isTrue);
      expect(result.isSuccess, isFalse);
      expect(result.blockedReasons, hasLength(1));
      expect(result.blockedReasons.single, contains('SPLIT_REQUIRED'));
      expect(result.canonicalTopologyArtifactId, isNull);
    });

    test('skippedUnsupportedSchemaVersions entries parse as raw maps '
        'without reinterpretation', () {
      final json = {
        'jobId': 'job-3',
        'status': 'success',
        'semanticPlanArtifactId': 'sp-3',
        'canonicalTopologyArtifactId': 'ct-3',
        'candidateState': 'CLOSED_SINGLE_LOOP',
        'sourceEnvelopeTopologyArtifactVersion': 5,
        'sourceEnvelopeTopologyArtifactSchemaVersion': 'envelope_topology_v2',
        'skippedNewerInvalidVersions': [6],
        'skippedUnsupportedSchemaVersions': [
          {'version': 7, 'schemaVersion': 'envelope_topology_v3_experimental'},
        ],
        'durationMs': 1000,
        'attempt': 2,
      };

      final result = CanonicalTopologyResult.fromJson(json);

      expect(result.skippedNewerInvalidVersions, [6]);
      expect(result.skippedUnsupportedSchemaVersions, hasLength(1));
      expect(result.skippedUnsupportedSchemaVersions.single['version'], 7);
    });
  });

  group('CanonicalTopologyFailure', () {
    test('carries the technical-failure detail string and is distinct from '
        'a normal blocked/success result type', () {
      final failure = CanonicalTopologyFailure('invalid token');
      expect(failure.detail, 'invalid token');
      expect(failure.toString(), contains('CanonicalTopologyFailure'));
      expect(failure, isA<Exception>());
    });
  });
}
