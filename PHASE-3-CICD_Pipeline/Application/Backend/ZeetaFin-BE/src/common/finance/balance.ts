export interface BalanceLine {
  debit: number;
  credit: number;
}

export const BALANCE_TOLERANCE = 0.01;

export function totalDebits(lines: BalanceLine[]): number {
  return lines.reduce((sum, line) => sum + line.debit, 0);
}

export function totalCredits(lines: BalanceLine[]): number {
  return lines.reduce((sum, line) => sum + line.credit, 0);
}

export function isBalanced(
  lines: BalanceLine[],
  tolerance: number = BALANCE_TOLERANCE,
): boolean {
  return Math.abs(totalDebits(lines) - totalCredits(lines)) <= tolerance;
}
