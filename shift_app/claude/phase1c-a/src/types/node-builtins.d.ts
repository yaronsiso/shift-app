// Minimal ambient declarations for Node's built-in test runner and strict
// assert module. Same offline-sandbox caveat as claude/phase1c-b's copy of
// this file: @types/node could not be fetched here. When integrating into
// the shift-app repo (which has normal npm registry access), install
// @types/node and delete this file.

declare module 'node:test' {
  export function test(name: string, fn: () => void | Promise<void>): void;
}

declare module 'node:assert/strict' {
  interface StrictAssert {
    (value: unknown, message?: string): asserts value;
    equal(actual: unknown, expected: unknown, message?: string): void;
    notEqual(actual: unknown, expected: unknown, message?: string): void;
    deepEqual(actual: unknown, expected: unknown, message?: string): void;
    notDeepEqual(actual: unknown, expected: unknown, message?: string): void;
    ok(value: unknown, message?: string): asserts value;
    throws(
      fn: () => unknown,
      error?: RegExp | Error | (new (...args: any[]) => Error) | ((e: unknown) => boolean),
      message?: string,
    ): void;
    doesNotThrow(fn: () => unknown, message?: string): void;
  }
  const assert: StrictAssert;
  export default assert;
}
