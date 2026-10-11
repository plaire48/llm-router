# Agent mascot

사용자가 선택한 세 번째 청록색 새 캐릭터를 고도화한 원본입니다. 제품 이름은 누비(Nubi)로 정했습니다.

- 부리 없는 데포르메 실루엣, 두 눈과 접힌 작은 날개를 유지합니다.
- 민트, 아쿠아, 청록에 푸른 반사광을 연결한 부드러운 입체 그라데이션입니다.
- 노란 부리와 작은 청록 부리는 검토 후 사용자 요청으로 제외했습니다.
- 원본은 `bird-master.png`, 제품용은 `public/icons/agent-bird.webp`와 `agent-{16,32,48,128}.png`입니다.
- `node scripts/icons.mjs`로 배포용 크기를 생성합니다. 원본 alpha를 유지합니다.
- 제공자 연결 버튼의 공식 로고와 분리합니다. 앱과 시스템 프롬프트는 누비(Nubi)로 표현합니다.
- 0.12.1부터 `누비`는 로컬 Noto Sans KR 700의 실제 텍스트로 표시합니다. 장식적인 이미지 글자는 사용자 요청으로 제외했습니다. `nubi-wordmark-master.png`와 [생성 프롬프트](WORDMARK-PROMPT.md)는 이전 시안 기록입니다.
- `nubi-logo.png`는 제품의 캐릭터와 글자를 함께 렌더링한 투명 배경 로고입니다. `node scripts/brand-preview.mjs`는 실제 확장 화면의 로고와 움직임 미리보기를 생성합니다.

Built-in image generation tool로 생성했습니다. 프롬프트:

```text
Use case: identity-preserve
Asset type: production brand mascot for a browser AI agent, standalone transparent PNG.
Input image: the reference brand board. The ONLY edit target is the THIRD, RIGHTMOST turquoise bird mascot. Ignore every word and the other two concepts.
Primary request: refine and extract that same little bird into a premium, beautifully rendered identity asset. Preserve its asymmetric plump bean/bird silhouette, upward-right head, exactly two dark navy oval eyes and one small folded mint wing on its lower left. Keep the same curious, clever, friendly, chibi Korean long-tailed-tit (baepsae) feeling. Do not turn it into a realistic bird or add beak, legs, eyebrows or extra parts.
Color/material: sophisticated smooth multi-stop neighboring-color gradients across mint, luminous aqua, turquoise, teal, with a restrained cool sky-blue reflection near the underside. Pale mint top-right light, fresh cyan midtones, deeper teal base. A soft pearlescent satin 3D finish, rounded volume, gently lit wing and delicate soft occlusion under the wing. Clear dark eyes with tiny subtle reflected light. Richer depth and color than the reference without hard specular glare, neon or plastic toy gloss.
Composition: ONE complete mascot only, centered in a square canvas, occupies about 86% of both dimensions, comfortable equal transparent padding, no cropping. The silhouette must be readable at tiny extension-icon sizes.
Background: genuine alpha transparency. No background plate, no white square, no checkerboard baked into image, no floor, no cast shadow or surrounding glow. No text, logos, letters, badges or extra sparkles.
Keep identity consistent with the selected rightmost character.
```

## Header wordmark (0.16.2)

`nubi-wordmark-condensed.png` is the generated Korean master. The user chose Hangul and requested a narrower horizontal silhouette. The active export is `public/icons/nubi-wordmark.webp`, shown at 42×24px with the existing animated 32px mascot and a 4px gap. `scripts/wordmark.mjs` trims transparent export padding and produces the WebP asset. Earlier wordmarks are design history. The full lockup opens a new chat and retains the preceding conversation and draft.

Generation direction: exact text 누비, narrow condensed proportions with close letterspacing, medium-bold softened corners, calm deep teal shading, transparent alpha background, no English, beak, badge or extra symbol. The approved bird master was the identity reference. The generator output is retained unchanged in this directory.
