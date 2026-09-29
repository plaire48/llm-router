import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createOrder} from '../src/order.mjs';
import {move} from '../src/status.mjs';
import {exportRow} from '../src/legacy/export.mjs';

test('주문 합계는 할인과 배송비를 반영한다', () => {
  const order = createOrder({items: [{price: 20000, quantity: 2}], grade: 'gold', region: 'jeju'});
  assert.deepEqual(order, {subtotal: 40000, discounted: 37200, shipping: 7500, total: 44700, status: 'received'});
});

test('주문 상태는 정해진 순서로만 바뀐다', () => {
  const order = createOrder({items: [{price: 1000, quantity: 1}]});
  assert.equal(move(order, 'paid').status, 'paid');
  assert.throws(() => move(order, 'delivered'), /invalid_transition/);
  assert.throws(() => move({...order, status: 'shipped'}, 'cancelled'), /invalid_transition/);
});

test('정산 내보내기 형식', () => {
  const order = createOrder({items: [{price: 60000, quantity: 1}], region: 'jeju'});
  assert.equal(exportRow(order, 'jeju'), '64500,4500,4500,received');
});
