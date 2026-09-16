import { constructCanonicalTopology } from './construct.js';
import { attempt3Raw, attempt3ApprovedPlan } from './fixtures/attempt3.js';

const candidate = constructCanonicalTopology(attempt3Raw, attempt3ApprovedPlan, 'attempt3-candidate');

console.log('=== Attempt #3 Canonical Topology Candidate ===\n');
console.log(`RAW vertices: ${attempt3Raw.vertices.length}`);
console.log(`RAW edges: ${attempt3Raw.edges.length}\n`);

console.log(`Canonical edges: ${candidate.edges.length}`);
console.log([...candidate.edges.map((e) => e.sourceRawEdgeIds.join('+'))].sort().join(', '));
console.log();

console.log(`Canonical gaps: ${candidate.gaps.length}`);
for (const g of candidate.gaps) {
  console.log(`  - ${g.gapId}: ${g.gapType}, knownEndpoints=[${g.knownEndpointVertexIds.join(',')}], unknownCount=${g.unknownEndpointCount}`);
}
console.log();

console.log(`Deferred issues: ${candidate.deferredIssues.length}`);
for (const d of candidate.deferredIssues) {
  console.log(`  - ${d.issueId}: ${d.issueType} (from ${d.relatedOperationId})`);
}
console.log();

console.log(`Connected components: ${candidate.connectedComponents.length}`);
for (const c of candidate.connectedComponents) {
  console.log(`  - ${c.componentId}: vertices=[${[...c.vertexIds].sort().join(',')}] edges=[${[...c.edgeIds].sort().join(',')}]`);
}
console.log();

console.log('State flags:', JSON.stringify(candidate.stateFlags, null, 2));
console.log('Candidate state:', candidate.candidateState);
console.log();

console.log('Validation results:');
for (const r of candidate.validationResults) {
  console.log(`  [${r.passed ? 'PASS' : 'FAIL'}] ${r.rule}: ${r.details}`);
}
