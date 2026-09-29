import {test} from 'node:test';
import assert from 'node:assert/strict';
import {discountRate, applyDiscount} from '../src/discount.mjs';

test('등급별 할인율', () => {
  assert.equal(discountRate('normal'), 0);
  assert.equal(discountRate('silver'), 3);
  assert.equal(discountRate('gold'), 7);
  assert.equal(discountRate('vip'), 12);
  assert.throws(() => discountRate('unknown'), /unknown_grade/);
});

test('할인 후 금액은 10원 단위로 내림한다', () => {
  assert.equal(applyDiscount(10000, 'gold'), 9300);
  assert.equal(applyDiscount(12345, 'silver'), 11970);
  assert.equal(applyDiscount(0, 'vip'), 0);
  assert.throws(() => applyDiscount(10.5, 'gold'), /invalid_amount/);
});
