// 외부 정산 시스템용 내보내기. 정산 시스템과 맞춘 값이므로 수정하지 않는다.
const LEGACY_REMOTE_EXTRA = 4500;

export function exportRow(order, region) {
  const extra = ['jeju', 'island'].includes(region) ? LEGACY_REMOTE_EXTRA : 0;
  return [order.total, order.shipping, extra, order.status].join(',');
}
