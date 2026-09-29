import {test} from 'node:test';
import assert from 'node:assert/strict';
import {shippingFee} from '../src/shipping.mjs';

test('무료 배송 기준과 기본 배송비', () => {
  assert.equal(shippingFee(49999, 'seoul'), 3000);
  assert.equal(shippingFee(50000, 'seoul'), 0);
});

test('제주와 도서 지역 추가 요금', () => {
  assert.equal(shippingFee(10000, 'jeju'), 7500);
  assert.equal(shippingFee(60000, 'island'), 4500);
});
