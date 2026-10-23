const test = require('node:test');
const assert = require('node:assert/strict');
const {
  BALANCE_TOLERANCE,
  isBalanced,
  totalCredits,
  totalDebits,
} = require('../dist/common/finance/balance');

test('totalDebits and totalCredits sum each side', () => {
  const lines = [
    { debit: 100, credit: 0 },
    { debit: 25.5, credit: 0 },
    { debit: 0, credit: 125.5 },
  ];

  assert.equal(totalDebits(lines), 125.5);
  assert.equal(totalCredits(lines), 125.5);
});

test('isBalanced accepts an exact balance', () => {
  assert.equal(isBalanced([{ debit: 10, credit: 10 }]), true);
});

test('isBalanced accepts differences inside the tolerance', () => {
  assert.equal(
    isBalanced([{ debit: 10, credit: 9.995 }], BALANCE_TOLERANCE),
    true,
  );
});

test('isBalanced rejects differences outside the tolerance', () => {
  assert.equal(
    isBalanced([{ debit: 10, credit: 9.98 }], BALANCE_TOLERANCE),
    false,
  );
});
