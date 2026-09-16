import { MeasurementWitnessBinding, TopologySpan } from "./types/model";

// ---- NO_DIMENSION_LINE_TO_TOPOLOGY_SHORTCUT --------------------------------
// TopologySpan is only constructible once bindingStatus=BOUND. This is the
// single choke point: no other function in this package constructs a
// TopologySpan, and this one refuses outside BOUND. There is deliberately no
// "force" parameter.

export function tryConstructTopologySpan(
  binding: MeasurementWitnessBinding
): TopologySpan | null {
  if (binding.bindingStatus !== "BOUND") {
    return null;
  }
  const fromAnchor = binding.start.selectedAnchor;
  const toAnchor = binding.end.selectedAnchor;
  if (fromAnchor === null || toAnchor === null) {
    // Should be unreachable if bindingStatus derivation is correct, but
    // guarded explicitly rather than asserted with `!` to keep this the
    // single hard gate.
    return null;
  }
  return {
    fromAnchor,
    toAnchor,
    bindingConfidence: binding.bindingConfidence,
  };
}
