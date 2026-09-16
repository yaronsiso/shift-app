// Minimal ambient declarations for Node's built-in test runner and strict
// assert module. These exist ONLY because @types/node could not be fetched
// in this offline sandbox; they are not a replacement for @types/node in the
// real project. When integrating into the shift-app repo (which has normal
// npm registry access), install @types/node and delete this file.

declare module 'node:test' {
  export function test(name: string, fn: () => void | Promise<void>): void;
}

declare module 'node:assert/strict' {
  interface StrictAssert {
    (value: unknown, message?: string): asserts value;
    equal(actual: unknown, expected: unknown, message?: string): void;
    notEqual(actual: unknown, expected: unknown, message?: string): void;
    deepEqual(actual: unknown, expected: unknown, message?: string): void;
    ok(value: unknown, message?: string): asserts value;
    throws(fn: () => unknown, error?: RegExp | Error | ((e: unknown) => boolean), message?: string): void;
    doesNotThrow(fn: () => unknown, message?: string): void;
  }
  const assert: StrictAssert;
  export default assert;
}

// Minimal ambient declarations for the handful of node:fs / node:url /
// node:path exports the regression snapshot test needs to locate and read
// the golden fixture JSON relative to its own file. Same offline-sandbox
// caveat as above: install @types/node and delete this block once this
// package has normal npm registry access.
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: string): string;
}

declare module 'node:url' {
  export function fileURLToPath(url: string): string;
}

declare module 'node:path' {
  export function dirname(path: string): string;
  export function join(...paths: string[]): string;
}
