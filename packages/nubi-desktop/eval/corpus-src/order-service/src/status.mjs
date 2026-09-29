const NEXT = Object.freeze({
  received: ['paid', 'cancelled'],
  paid: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
});

export function canMove(from, to) {
  return (NEXT[from] || []).includes(to);
}

export function move(order, to) {
  if (!canMove(order.status, to)) throw new Error('invalid_transition');
  return {...order, status: to};
}
