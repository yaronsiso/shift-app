// test/features/sketch_analysis_v2_debug/data/sketch_envelope_topology_service_test.dart
//
// Focused, pure-Dart tests (no widget pump, no Supabase mock server) for
// EnvelopeTopologyResult's JSON parsing and its `isValid` gate — the exact
// value sketch_scope_debug_screen.dart's CanonicalTopology button uses to
// decide whether it may be invoked at all. These tests exercise real
// response shapes returned by the deployed
// analyze-sketch-v2-envelope-topology/index.ts (status: "valid" with
// diagnostics-only issues, "invalid" with a fatal error, and
// "forbidden_field_error"), not invented ones.

import 'package:flutter_test/flutter_test.dart';
import 'package:shift_app/features/sketch_analysis_v2_debug/data/sketch_envelope_topology_service.dart';

void main() {
  group('EnvelopeTopologyResult.fromJson / isValid', () {
    test('status:"valid" with only diagnostics (open graph, disconnected, '
        'uncertain hints) parses correctly and isValid is true', () {
      final json = {
        'jobId': 'job-1',
        'artifactId': 'artifact-1',
        'status': 'valid',
        'topology': {
          'schemaVersion': 'envelope_topology_v2',
          'vertices': [
            {
              'id': 'v1',
              'imagePct': {'xPct': 10.0, 'yPct': 10.0},
              'cornerAngleHint': 'orthogonal_90',
            },
            {
              'id': 'v2',
              'imagePct': {'xPct': 50.0, 'yPct': 10.0},
              'cornerAngleHint': null,
            },
          ],
          'edges': [
            {
              'id': 'e1',
              'fromVertexId': 'v1',
              'toVertexId': 'v2',
              'axisHint': 'horizontal',
              'roleHint': 'exterior_wall',
            },
          ],
          'perceptionNotes': null,
        },
        'validation': {
          'valid': true,
          'errors': <dynamic>[],
          'diagnostics': [
            {
              'code': 'OPEN_GRAPH_ENDPOINTS',
              'message': 'v2 has degree 1',
              'relatedIds': ['v2'],
            },
            {
              'code': 'NOT_SINGLE_CLOSED_CYCLE',
              'message': 'graph is not a single closed cycle',
              'relatedIds': <dynamic>[],
            },
            {
              'code': 'UNCERTAIN_HINT_PRESENT',
              'message': 'uncertain hints present',
              'relatedIds': ['v2'],
            },
          ],
        },
        'model': 'gpt-5.6-luna',
        'durationMs': 1234,
        'attempt': 1,
      };

      final result = EnvelopeTopologyResult.fromJson(json);

      expect(result.status, 'valid');
      expect(result.isValid, isTrue,
          reason: 'diagnostics-only issues must never affect isValid');
      expect(result.topology, isNotNull);
      expect(result.topology!.vertices, hasLength(2));
      expect(result.topology!.edges, hasLength(1));
      expect(result.validation!.valid, isTrue);
      expect(result.validation!.errors, isEmpty);
      expect(result.validation!.diagnostics, hasLength(3));
      expect(
        result.validation!.diagnostics.map((d) => d.code),
        containsAll(['OPEN_GRAPH_ENDPOINTS', 'NOT_SINGLE_CLOSED_CYCLE', 'UNCERTAIN_HINT_PRESENT']),
      );
    });

    test('status:"invalid" (e.g. a real ZERO_LENGTH_EDGE fatal) parses '
        'correctly and isValid is false', () {
      final json = {
        'jobId': 'job-2',
        'artifactId': 'artifact-2',
        'status': 'invalid',
        'topology': {
          'schemaVersion': 'envelope_topology_v2',
          'vertices': [
            {
              'id': 'v1',
              'imagePct': {'xPct': 0.7, 'yPct': 0.6},
              'cornerAngleHint': null,
            },
            {
              'id': 'v13',
              'imagePct': {'xPct': 0.7, 'yPct': 0.6},
              'cornerAngleHint': null,
            },
          ],
          'edges': [
            {
              'id': 'e13',
              'fromVertexId': 'v13',
              'toVertexId': 'v1',
              'axisHint': 'diagonal_or_unknown',
              'roleHint': 'uncertain',
            },
          ],
          'perceptionNotes': null,
        },
        'validation': {
          'valid': false,
          'errors': [
            {
              'code': 'ZERO_LENGTH_EDGE',
              'message': 'Edge e13 has near-zero image-space length',
              'relatedIds': ['e13'],
            },
          ],
          'diagnostics': <dynamic>[],
        },
        'model': 'gpt-5.6-luna',
        'durationMs': 900,
        'attempt': 2,
      };

      final result = EnvelopeTopologyResult.fromJson(json);

      expect(result.status, 'invalid');
      expect(result.isValid, isFalse);
      expect(result.validation!.valid, isFalse);
      expect(result.validation!.errors.single.code, 'ZERO_LENGTH_EDGE');
    });

    test('status:"forbidden_field_error" parses with null topology/validation '
        'and isValid is false', () {
      final json = {
        'jobId': 'job-3',
        'artifactId': 'artifact-3',
        'status': 'forbidden_field_error',
        'topology': null,
        'validation': null,
        'error': 'EnvelopeTopologyV2 payload contains forbidden field "meters"',
        'model': 'gpt-5.6-luna',
        'durationMs': 500,
        'attempt': 1,
      };

      final result = EnvelopeTopologyResult.fromJson(json);

      expect(result.status, 'forbidden_field_error');
      expect(result.isValid, isFalse);
      expect(result.topology, isNull);
      expect(result.validation, isNull);
      expect(result.error, contains('forbidden field'));
    });
  });
}
