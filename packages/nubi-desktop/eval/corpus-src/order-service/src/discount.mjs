// 등급별 할인율(퍼센트 정수). 새 등급은 이 표에만 추가한다.
export const RATES = Object.freeze({normal: 0, silver: 3, gold: 7, vip: 12});

export function discountRate(grade) {
  if (!Object.hasOwn(RATES, grade)) throw new Error('unknown_grade');
  return RATES[grade];
}

// 할인 후 금액은 10원 단위로 내림한다.
export function applyDiscount(amount, grade) {
  if (!Number.isInteger(amount) || amount < 0) throw new Error('invalid_amount');
  return Math.floor(amount * (100 - discountRate(grade)) / 1000) * 10;
}
