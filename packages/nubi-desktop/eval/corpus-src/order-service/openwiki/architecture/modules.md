---
type: architecture
title: 모듈 구성
description: 주문 서비스의 소스 파일과 각 파일의 책임.
tags: [구성, 모듈]
---

# 모듈 구성

| 파일 | 책임 |
|---|---|
| `src/order.mjs` | 주문을 만들고 소계, 할인 후 금액, 배송비, 합계를 계산 |
| `src/discount.mjs` | 등급별 할인율과 할인 후 금액 |
| `src/shipping.mjs` | 배송비 |
| `src/status.mjs` | 주문 상태 이동 |
| `src/legacy/export.mjs` | 외부 정산 시스템용 내보내기 |

`createOrder`는 소계에 할인을 먼저 적용하고, 할인 후 금액으로 배송비를 계산한다.
