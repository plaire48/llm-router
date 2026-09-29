import {applyDiscount} from './discount.mjs';
import {shippingFee} from './shipping.mjs';

export function createOrder({items, grade = 'normal', region = 'seoul'}) {
  if (!Array.isArray(items) || !items.length) throw new Error('empty_order');
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const discounted = applyDiscount(subtotal, grade);
  const shipping = shippingFee(discounted, region);
  return {subtotal, discounted, shipping, total: discounted + shipping, status: 'received'};
}
