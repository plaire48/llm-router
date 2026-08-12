# Fix: 대시보드 빈 상태 문구가 데이터가 있어도 계속 표시됨

**심각도:** 중간 (기능은 동작하나 UI가 모순된 상태를 보여줌 — 41건이 표시된 채로 "아직 기록된 호출이 없습니다"가 같이 보임)

## 증상

호출 이력 테이블에 행이 있는데도 빈 상태 문구가 표 아래에 계속 표시된다. 실제 브라우저에서 확인:

```
rows: 41, emptyHidden: true, emptyVisible: true, computedDisplay: "grid"
```

## 원인

`src/llm_router/usage/dashboard.html:786`의 JS는 **정상 동작한다** — 행이 있으면 `callsEmpty.hidden = true`를 올바르게 설정한다.

문제는 CSS다. `dashboard.html:334`의

```css
.empty {
  display: grid;
  ...
}
```

클래스 선택자의 `display: grid`가 브라우저 기본 스타일시트의 `[hidden] { display: none }`보다 우선순위가 높다. 그래서 `hidden` 속성이 붙어도 화면에서 사라지지 않는다. `hidden`을 쓰는 다른 `.empty` 요소도 모두 같은 문제를 가진다.

## 수정

`dashboard.html`의 `<style>` 안, `.empty` 규칙 **앞**에 전역 규칙을 추가한다.

```css
[hidden] { display: none !important; }
```

`!important`가 필요한 이유: `.empty`의 `display: grid`가 이미 존재하므로, 속성 선택자만으로는 특정도(specificity)에서 밀린다. 전역 규칙 하나로 `hidden`을 쓰는 모든 요소가 함께 고쳐진다.

## 회귀 테스트

`tests/test_usage_api.py`의 대시보드 테스트에 추가한다.

- [ ] **Step 1: 실패 테스트**

```python
def test_dashboard_hidden_attribute_is_not_defeated_by_css(tmp_path):
    store = UsageStore(tmp_path / "u.db")
    try:
        with TestClient(create_app(SETTINGS, REGISTRY, store=store)) as client:
            body = client.get("/dashboard").text
        assert "[hidden]" in body, "no global [hidden] rule; .empty { display: grid } wins"
    finally:
        store.close()
```

- [ ] **Step 2: 실패 확인**

Run: `python3 -m pytest tests/test_usage_api.py -k hidden -v`
Expected: FAIL — 전역 `[hidden]` 규칙 없음.

- [ ] **Step 3: 위 CSS 규칙 추가**

- [ ] **Step 4: 통과 확인**

Run: `python3 -m pytest -q && ruff check src tests`
Expected: 전체 PASS.

- [ ] **Step 5: 수동 확인**

`llm-router serve` 후 `/dashboard`를 열어, 데이터가 있을 때 빈 상태 문구가 사라지는지 확인한다. 브라우저 콘솔에서:

```js
getComputedStyle(document.getElementById('calls-empty')).display  // "none" 이어야 함
```

- [ ] **Step 6: 커밋**

```bash
git add src/llm_router/usage/dashboard.html tests/test_usage_api.py
git commit -m "fix: stop .empty display rule from defeating the hidden attribute"
```
