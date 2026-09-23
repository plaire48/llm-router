import { readFileSync } from "node:fs";
import type { ServerResponse } from "node:http";

export type AiproCallbackState = "success" | "error" | "cancelled" | "expired";

const TITLES: Record<AiproCallbackState, string> = {
  success: "인증이 완료되었습니다",
  error: "인증을 완료하지 못했습니다",
  cancelled: "로그인이 취소되었습니다",
  expired: "로그인 시간이 만료되었습니다",
};

// Inline fonts survive the one-use callback server closing, without a CDN request.
const FONT_STYLES = readFileSync(
  new URL("./aipro-callback-fonts.css", import.meta.url),
  "utf8",
);

const ICONS = {
  book: '<path d="M12 7c-2-2-5-3-9-2v14c4-1 7 0 9 2m0-14c2-2 5-3 9-2v14c-4-1-7 0-9 2V7Z"/>',
  check: '<path class="check-stroke" pathLength="1" d="m5 12 4.5 4.5L19 7"/>',
  terminal: '<path d="m5 7 5 5-5 5m9 0h5"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  attention: '<path d="M12 7v6m0 4h.01"/><circle cx="12" cy="12" r="9"/>',
};

function icon(name: keyof typeof ICONS): string {
  return `<svg viewBox="0 0 24 24" class="icon" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

export function renderAiproCallbackPage(state: AiproCallbackState): string {
  const success = state === "success";
  const heading = success
    ? '인증이 <span class="accent">완료되었습니다</span>'
    : TITLES[state];
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${TITLES[state]} · openwiki-SDS</title>
  <style>
    ${FONT_STYLES}
    :root { color-scheme: light; --blue: #3182f6; --blue-deep: #1b64da; --ink: #191f28; --sub: #4e5968; --ease: cubic-bezier(.22,.61,.36,1); font-family: "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif; color: var(--ink); background: #eaf3fe; font-synthesis: none; }
    * { box-sizing: border-box; }
    body { min-height: 100vh; min-height: 100svh; margin: 0; display: flex; flex-direction: column; -webkit-font-smoothing: antialiased; background: linear-gradient(155deg, #eaf3fe 0%, #e9f2fd 42%, #eceffd 72%, #e9f6f2 100%); }
    .ambient { position: fixed; inset: 0; overflow: hidden; pointer-events: none; }
    .blob { position: absolute; width: 55vmin; height: 55vmin; border-radius: 50%; }
    .blob-one { left: -16vmin; top: -18vmin; background: radial-gradient(circle, #3182f622, transparent 68%); }
    .blob-two { right: -16vmin; bottom: -22vmin; background: radial-gradient(circle, #7b61e61a, transparent 68%); }
    .blob-three { right: 7%; top: -20vmin; background: radial-gradient(circle, #189bb016, transparent 68%); }
    .spark { position: absolute; color: #fff; width: 18px; height: 18px; filter: drop-shadow(0 2px 9px #3182f644); animation: twinkle 3.2s ease-in-out infinite; }
    .s1 { left: 12%; top: 26%; width: 22px; height: 22px; }
    .s2 { left: 18%; top: 72%; color: #64a8f8; animation-delay: -1.1s; }
    .s3 { right: 12%; top: 20%; width: 24px; height: 24px; animation-delay: -.6s; }
    .s4 { right: 17%; top: 68%; color: #64a8f8; animation-delay: -1.7s; }
    .s5 { left: 46%; top: 11%; width: 12px; height: 12px; animation-delay: -2.2s; }
    .s6 { right: 39%; bottom: 10%; width: 12px; height: 12px; animation-delay: -.3s; }
    header, main, footer { position: relative; }
    header { display: flex; align-items: center; gap: 10px; padding: 28px 40px; }
    .brand-mark { display: grid; place-items: center; width: 34px; height: 34px; color: var(--blue); background: #fff; border-radius: 11px; box-shadow: 0 4px 14px #3182f60b; }
    .brand-mark .icon { width: 20px; height: 20px; }
    .brand-name { font-size: 16px; font-weight: 750; letter-spacing: -.6px; }
    .context { margin-left: auto; color: #5b6d83; font-size: 12px; }
    main { flex: 1; width: min(100%, 700px); margin: 0 auto; padding: 24px 24px 64px; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; }
    .reveal { animation: rise .55s var(--ease) both; animation-delay: var(--delay, 0s); }
    .illustration { position: relative; width: 320px; height: 172px; margin-bottom: 22px; }
    .aura { position: absolute; width: 260px; height: 200px; left: 30px; top: -10px; border-radius: 50%; background: radial-gradient(ellipse, #fff9, transparent 70%); }
    .hero-wrap { position: absolute; top: 26px; left: 104px; }
    .hero-icon { display: grid; place-items: center; width: 112px; height: 112px; border-radius: 32px; color: var(--blue); background: #fff; box-shadow: 0 14px 44px #191f2812, inset 0 -3px 0 #e8f1fe; animation: floaty 6s ease-in-out infinite; }
    .hero-icon .icon { width: 54px; height: 54px; stroke-width: 2.7; }
    .check-stroke { stroke-dasharray: 1; animation: draw .65s var(--ease) .35s both; }
    .fragment { position: absolute; display: grid; place-items: center; background: #ffffffdc; box-shadow: 0 10px 28px #191f280a; }
    .fragment .icon { width: 26px; height: 26px; }
    .fragment-book { width: 62px; height: 62px; left: 12px; top: 12px; border-radius: 20px; color: #189bb0; transform: rotate(-12deg); }
    .fragment-book .tile { background: #e6f6f9; }
    .fragment-terminal { width: 58px; height: 58px; right: 14px; top: 100px; border-radius: 19px; color: #7b61e6; transform: rotate(10deg); }
    .fragment-terminal .tile { background: #efecfd; }
    .fragment .tile { display: grid; place-items: center; width: 42px; height: 42px; border-radius: 14px; }
    .floating-book { animation: floaty 6.5s ease-in-out -.8s infinite; }
    .floating-terminal { animation: floaty 7s ease-in-out -2s infinite; }
    .orbit-dot { position: absolute; width: 7px; height: 7px; background: #64a8f8; border-radius: 50%; left: 55px; bottom: 20px; opacity: .45; }
    .orbit-dot.second { width: 5px; height: 5px; left: auto; right: 57px; top: 34px; background: #7b61e6; }
    .eyebrow { margin: 0 0 12px; color: var(--blue-deep); font-size: 12px; font-weight: 700; letter-spacing: .1em; }
    h1 { margin: 0; font-size: clamp(28px, 4.2vw, 42px); line-height: 1.4; font-weight: 800; letter-spacing: -.045em; word-break: keep-all; }
    .accent { display: block; background: linear-gradient(92deg, #1b64da, #3182f6 70%, #579af0); color: transparent; background-clip: text; -webkit-background-clip: text; }
    .description { max-width: 370px; margin: 18px 0 0; color: var(--sub); font-size: 15px; line-height: 1.8; letter-spacing: -.02em; word-break: keep-all; }
    .next-step { display: flex; align-items: center; gap: 14px; width: min(100%, 390px); margin-top: 30px; padding: 20px 22px; border: 1px solid #fff; border-radius: 22px; text-align: left; background: #fff; box-shadow: 0 14px 44px #191f2810; }
    .terminal { flex: 0 0 44px; width: 44px; height: 44px; display: grid; place-items: center; border-radius: 14px; color: var(--blue); background: #e8f1fe; }
    .terminal .icon { width: 23px; height: 23px; }
    .next-step strong { display: block; font-size: 14px; line-height: 1.7; font-weight: 700; letter-spacing: -.025em; }
    .next-step p { margin: 3px 0 0; color: #5c6877; font-size: 12px; line-height: 1.7; letter-spacing: -.02em; word-break: keep-all; }
    .next-step > .icon { margin-left: auto; flex: 0 0 18px; width: 18px; height: 18px; color: #8b95a1; }
    footer { padding: 0 20px 25px; color: #657488; font-size: 12px; text-align: center; }
    .attention .hero-icon { color: #c07824; }
    .attention h1 { max-width: 540px; font-size: clamp(26px, 4vw, 36px); }
    @keyframes rise { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes floaty { 50% { transform: translateY(-11px); } }
    @keyframes twinkle { 0%, 100% { opacity: .25; transform: scale(.85); } 50% { opacity: 1; transform: scale(1.1); } }
    @keyframes draw { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
    @media (max-width: 480px) {
      header { padding: 20px 24px; gap: 8px; }
      .brand-name { font-size: 15px; }
      .context { font-size: 11px; }
      main { padding: 20px 24px 44px; }
      .illustration { width: 290px; }
      .hero-wrap { left: 89px; }
      .aura { left: 15px; }
      .fragment-book { left: 0; }
      .fragment-terminal { right: 0; }
      h1 { font-size: 32px; }
      .description { max-width: 275px; font-size: 14px; }
      .next-step { padding: 18px; margin-top: 26px; gap: 12px; }
      .next-step > .icon { display: none; }
      .spark { opacity: .4; }
    }
    @media (max-height: 680px) {
      header { padding-top: 16px; padding-bottom: 16px; }
      main { padding-top: 4px; padding-bottom: 24px; }
      .illustration { zoom: .75; margin-bottom: 12px; }
      h1 { font-size: 30px; }
      .description { margin-top: 12px; }
      .next-step { margin-top: 20px; }
      footer { padding-bottom: 16px; }
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { animation: none !important; }
      .check-stroke { stroke-dashoffset: 0; }
    }
  </style>
</head>
<body class="${success ? "connected" : "attention"}">
  <div class="ambient" aria-hidden="true">
    <span class="blob blob-one"></span><span class="blob blob-two"></span><span class="blob blob-three"></span>
    ${[1, 2, 3, 4, 5, 6].map((n) => `<svg class="spark s${n}" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C13 8 16 11 24 12C16 13 13 16 12 24C11 16 8 13 0 12C8 11 11 8 12 0Z"/></svg>`).join("")}
  </div>
  <header class="reveal">
    <span class="brand-mark">${icon("book")}</span>
    <span class="brand-name">openwiki-SDS</span>
    <span class="context">계정 연결</span>
  </header>
  <main>
    <div class="illustration reveal" aria-hidden="true" style="--delay: .08s">
      <span class="aura"></span>
      <div class="hero-wrap"><span class="hero-icon">${icon(success ? "check" : "attention")}</span></div>
      <div class="floating-book"><span class="fragment fragment-book"><span class="tile">${icon("book")}</span></span></div>
      <div class="floating-terminal"><span class="fragment fragment-terminal"><span class="tile">${icon("terminal")}</span></span></div>
      <span class="orbit-dot"></span><span class="orbit-dot second"></span>
    </div>
    <p class="eyebrow reveal" style="--delay: .14s">openwiki-SDS</p>
    <h1 class="reveal" style="--delay: .22s">${heading}</h1>
    <p class="description reveal" style="--delay: .30s">${success ? "이 창을 닫고 openwiki-SDS 터미널로 돌아가세요." : "openwiki-SDS 터미널에서 다시 로그인해 주세요."}</p>
    <div class="next-step reveal" style="--delay: .42s">
      <span class="terminal">${icon("terminal")}</span>
      <div>
        <strong>${success ? "터미널에서 이어가세요" : "터미널에서 다시 시작해 주세요"}</strong>
        <p>${success ? "모델을 선택해 설정을 마무리하세요." : "로그인을 시작하면 새 창이 열립니다."}</p>
      </div>
      ${icon("arrow")}
    </div>
  </main>
  <footer class="reveal" style="--delay: .52s">이 창은 닫아도 괜찮아요.</footer>
</body>
</html>`;
}

/** Flush the page before closing the one-use callback listener. */
export function sendAiproCallbackPage(
  response: ServerResponse | undefined,
  state: AiproCallbackState,
): Promise<void> {
  if (!response || response.destroyed || response.writableEnded)
    return Promise.resolve();
  response.statusCode = state === "success" ? 200 : 400;
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  );
  response.setHeader("Connection", "close");
  return new Promise((resolve) => {
    const done = () => {
      response.off("finish", done);
      response.off("close", done);
      response.off("error", done);
      resolve();
    };
    response.once("finish", done);
    response.once("close", done);
    response.once("error", done);
    response.end(renderAiproCallbackPage(state));
  });
}
