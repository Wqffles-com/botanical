declare module "bun:test" {
  interface Matchers {
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toBeNull(): void;
    toBeDefined(): void;
    toThrow(expected?: unknown): void;
    toContain(expected: string): void;
    toBeInstanceOf(expected: abstract new (...args: never[]) => unknown): void;
    not: Matchers;
  }

  export function describe(name: string, fn: () => void): void;
  export function test(name: string, fn: () => void | Promise<void>): void;
  export function expect(actual: unknown): Matchers;
}
