// Minimal ambient declarations for Node's built-in test runner and assert
// module, hand-written because @types/node is not fetchable in this sandbox
// (no network access). Mirrors the same workaround used in Phase 1C-B.
// DELETE once real @types/node is available in the actual repo.

declare module "node:test" {
  type TestFn = (t: unknown) => void | Promise<void>;
  function test(name: string, fn: TestFn): void;
  namespace test {}
  export default test;
}

declare module "node:assert/strict" {
  interface AssertStrict {
    (value: unknown, message?: string): void;
    equal(actual: unknown, expected: unknown, message?: string): void;
    notEqual(actual: unknown, expected: unknown, message?: string): void;
    deepEqual(actual: unknown, expected: unknown, message?: string): void;
    deepStrictEqual(actual: unknown, expected: unknown, message?: string): void;
    ok(value: unknown, message?: string): void;
    throws(fn: () => unknown, message?: string): void;
    doesNotThrow(fn: () => unknown, message?: string): void;
  }
  const assert: AssertStrict;
  export default assert;
}
