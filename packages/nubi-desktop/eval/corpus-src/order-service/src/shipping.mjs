export const FREE_SHIPPING_MIN = 50000;
export const BASE_FEE = 3000;
export const REMOTE_EXTRA = 4500;
const REMOTE_REGIONS = new Set(['jeju', 'island']);

// 주문 금액과 지역으로 배송비를 계산한다. 무료 배송이어도 제주와 도서 지역 추가 요금은 받는다.
export function shippingFee(total, region) {
  if (!Number.isInteger(total) || total < 0) throw new Error('invalid_amount');
  const base = total >= FREE_SHIPPING_MIN ? 0 : BASE_FEE;
  return base + (REMOTE_REGIONS.has(region) ? REMOTE_EXTRA : 0);
}
