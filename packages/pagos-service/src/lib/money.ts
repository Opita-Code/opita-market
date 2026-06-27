/**
 * Money utilities — integer-only COP arithmetic.
 *
 * INVARIANT: COP has no sub-unit. 1 unit = 1 COP.
 * NEVER use float for money. NEVER use BigInt (overkill — COP < 2^53).
 *
 * COP_MAX_SAFE = Number.MAX_SAFE_INTEGER = 9_007_199_254_740_991
 * Tier 4 max yearly = 500_000_000 * 365 = 1.825×10^11, well below COP_MAX_SAFE.
 *
 * All functions throw AmountInvalidError-like messages via plain Error
 * (typed errors live in errors.ts but we avoid the import cycle here).
 */

export const COP_MAX_SAFE = Number.MAX_SAFE_INTEGER;

/**
 * Throws if `n` is not a non-negative safe integer.
 */
function assertValidInteger(n: unknown, name: string): asserts n is number {
  if (typeof n !== "number") {
    throw new Error(`${name} must be a number, got ${typeof n}`);
  }
  if (!Number.isInteger(n)) {
    throw new Error(`${name} must be an integer, got ${n}`);
  }
  if (n < 0) {
    throw new Error(`${name} must be non-negative, got ${n}`);
  }
  if (n > COP_MAX_SAFE) {
    throw new Error(`${name} exceeds COP_MAX_SAFE (${COP_MAX_SAFE})`);
  }
}

export function add(a: number, b: number): number {
  assertValidInteger(a, "a");
  assertValidInteger(b, "b");
  const sum = a + b;
  if (sum > COP_MAX_SAFE) {
    throw new Error(`addition overflow: ${a} + ${b} > COP_MAX_SAFE`);
  }
  return sum;
}

export function subtract(a: number, b: number): number {
  assertValidInteger(a, "a");
  assertValidInteger(b, "b");
  const diff = a - b;
  if (diff < 0) {
    throw new Error(`subtraction would result in negative: ${a} - ${b} = ${diff}`);
  }
  return diff;
}

export function isPositive(n: number): boolean {
  return typeof n === "number" && Number.isInteger(n) && n > 0;
}

export function isZero(n: number): boolean {
  return n === 0;
}

export function maxCop(a: number, b: number): number {
  assertValidInteger(a, "a");
  assertValidInteger(b, "b");
  return a >= b ? a : b;
}

export function sumAll(values: number[]): number {
  let total = 0;
  for (const v of values) {
    assertValidInteger(v, "values[i]");
    total = add(total, v);
  }
  return total;
}

/**
 * Format integer COP for user-facing display.
 * Uses es-CO thousands separator (period).
 */
export function formatCop(n: number): string {
  assertValidInteger(n, "n");
  const formatted = n.toLocaleString("es-CO", { useGrouping: true });
  return `COP $${formatted}`;
}