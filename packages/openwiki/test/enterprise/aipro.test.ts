/* eslint @typescript-eslint/require-await: "off" -- Fetch and credential mocks intentionally resolve without I/O. */
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  fetchAiproModels,
  hasAiproToken,
  loginWithAipro,
  readAiproToken,
} from "../../src/auth/aipro.js";

const token = (exp = Date.now() / 1000 + 3600) =>
  `e30.${Buffer.from(JSON.stringify({ exp, sub: "synthetic" })).toString("base64url")}.test`;
afterEach(() => vi.unstubAllEnvs());

describe("AI Pro SSO", () => {
  test("receives a real loopback callback, exchanges code once, then closes", async () => {
    let callback!: string;
    let received!: () => void;
    const ready = new Promise<void>((resolve) => {
      received = resolve;
    });
    let finish!: () => void;
    const exchange = vi.fn(async (_url: unknown, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("Content-Type")).toBe(
        "application/x-www-form-urlencoded",
      );
      expect(
        new URLSearchParams(
          typeof init?.body === "string" ? init.body : "",
        ).get("code"),
      ).toBe("synthetic-code");
      expect(init?.redirect).toBe("error");
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return Response.json({ token: token() });
    });
    const login = loginWithAipro(
      (url) => {
        expect(url).toContain("/auth/cli/login?port=");
        callback = `http://127.0.0.1:${new URL(url).searchParams.get("port")}/auth?status=00&code=synthetic-code`;
        received();
      },
      { fetchImpl: exchange },
    );
    await ready;
    expect(
      (await fetch(callback, { headers: { Origin: "https://evil.example" } }))
        .status,
    ).toBe(403);
    expect(exchange).not.toHaveBeenCalled();
    let responded = false;
    const page = fetch(callback).then((response) => {
      responded = true;
      return response;
    });
    await vi.waitFor(() => expect(exchange).toHaveBeenCalledTimes(1));
    expect(responded).toBe(false);
    expect((await fetch(callback)).status).toBe(409);
    finish();
    const response = await page;
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/html");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Security-Policy")).toContain(
      "default-src 'none'",
    );
    expect(html).toContain("인증이 완료되었습니다");
    expect(html).toContain("openwiki-SDS 터미널로 돌아가세요");
    expect(html).toContain("openwiki-SDS");
    expect(html).not.toMatch(/<img|data:image|AI Pro/);
    expect(html).toContain("</html>");
    expect(html).not.toContain("synthetic-code");
    expect(html).not.toMatch(/<object|<script|(?:src|href)="https?:/i);
    expect(hasAiproToken(await login)).toBe(true);
    expect(exchange).toHaveBeenCalledTimes(1);
    await expect(fetch(callback)).rejects.toThrow();
  });

  test("cancel rejects late exchange results and does not retry", async () => {
    const controller = new AbortController();
    let callback!: string;
    let ready!: () => void;
    const started = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const exchange = vi.fn(
      async (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            { once: true },
          );
        }),
    );
    const result = loginWithAipro(
      (url) => {
        callback = `http://127.0.0.1:${new URL(url).searchParams.get("port")}/auth?status=00&code=abc`;
        ready();
      },
      { fetchImpl: exchange, signal: controller.signal },
    );
    const rejection = expect(result).rejects.toThrow("취소");
    await started;
    const page = fetch(callback);
    await vi.waitFor(() => expect(exchange).toHaveBeenCalledTimes(1));
    controller.abort();
    const response = await page;
    expect(response.status).toBe(400);
    const html = await response.text();
    expect(html).toContain("로그인이 취소되었습니다");
    expect(html).not.toContain("인증이 완료되었습니다");
    await rejection;
    expect(exchange).toHaveBeenCalledTimes(1);
    await expect(fetch(callback)).rejects.toThrow();
  });

  test("times out and rejects failed or malformed token exchanges", async () => {
    await expect(loginWithAipro(() => {}, { timeoutMs: 10 })).rejects.toThrow(
      "만료",
    );
    for (const payload of [
      { token: "private-invalid-token" },
      { token: token(), success: false },
    ]) {
      let page!: Promise<Response>;
      const result = loginWithAipro(
        (url) => {
          page = fetch(
            `http://127.0.0.1:${new URL(url).searchParams.get("port")}/auth?status=00&code=test`,
          );
        },
        { fetchImpl: vi.fn(async () => Response.json(payload)) },
      );
      await expect(result).rejects.toThrow("인증 교환에 실패");
      const response = await page;
      expect(response.status).toBe(400);
      const html = await response.text();
      expect(html).toContain("인증을 완료하지 못했습니다");
      expect(html).not.toContain("인증이 완료되었습니다");
      expect(html).not.toContain(payload.token);
    }
  });

  test("an exchange timeout displays failure instead of a premature success page", async () => {
    let page!: Promise<Response>;
    const result = loginWithAipro(
      (url) => {
        page = fetch(
          `http://127.0.0.1:${new URL(url).searchParams.get("port")}/auth?status=00&code=timeout-code`,
        );
      },
      {
        timeoutMs: 100,
        fetchImpl: (_url, init) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => reject(new Error("aborted")),
              { once: true },
            );
          }),
      },
    );
    await expect(result).rejects.toThrow("만료");
    const response = await page;
    expect(response.status).toBe(400);
    const html = await response.text();
    expect(html).toContain("로그인 시간이 만료되었습니다");
    expect(html).not.toContain("인증이 완료되었습니다");
    expect(html).not.toContain("timeout-code");
  });

  test("validates expiration without including the token in errors", () => {
    expect(readAiproToken(token())).toContain("e30.");
    expect(hasAiproToken(token(1))).toBe(false);
    expect(hasAiproToken("not-a-token")).toBe(false);
    expect(() => readAiproToken("sensitive-value")).toThrow("로그인");
  });

  test("Browser SSO discovers all valid names regardless of target or is_agent", async () => {
    const credential = token();
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("Authorization")).toBe(
        `Bearer ${credential}`,
      );
      // Exactly the headers the AI Pro browser client sends for this request.
      expect(Object.fromEntries(new Headers(init?.headers).entries())).toEqual({
        accept: "application/json",
        authorization: `Bearer ${credential}`,
        "x-reasoning": "true",
      });
      return Response.json({
        modelList: [
          {
            name: "agent-model",
            target: "agent",
            is_agent: true,
            sort_seq: 2,
          },
          {
            name: "GLM-5.2-NVFP4",
            display_name: "GLM",
            target: "other",
            is_agent: false,
            sort_seq: 1,
          },
          { name: "agent-model", sort_seq: 3 },
          { display_name: "missing name" },
        ],
      });
    });
    expect(await fetchAiproModels(credential, { fetchImpl })).toEqual([
      { id: "GLM-5.2-NVFP4", label: "GLM" },
      { id: "agent-model", label: "agent-model" },
    ]);
    await expect(
      fetchAiproModels(credential, {
        fetchImpl: vi.fn(async () => Response.json({ modelList: [] })),
      }),
    ).rejects.toThrow("모델");
  });
});
