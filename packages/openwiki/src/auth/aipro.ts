import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { AiproProvider } from "../config/constants.js";
import {
  sendAiproCallbackPage,
  type AiproCallbackState,
} from "./aipro-callback-page.js";

export const AIPRO_ORIGIN = "https://aipro.sdsdev.co.kr";
export const AIPRO_TOKEN_KEY = "AIPRO_ACCESS_TOKEN";
export const AIPRO_CLI_TOKEN_KEY = "AIPRO_CLI_TOKEN";

const hasControl = (value: string) =>
  Array.from(value).some(
    (char) => char.charCodeAt(0) <= 31 || char.charCodeAt(0) === 127,
  );

export function readAiproToken(value = process.env[AIPRO_TOKEN_KEY]): string {
  try {
    if (
      !value ||
      value.length > 16384 ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)
    )
      throw new Error();
    const claims: unknown = JSON.parse(
      Buffer.from(value.split(".")[1], "base64url").toString(),
    );
    if (
      !claims ||
      typeof claims !== "object" ||
      Array.isArray(claims) ||
      !Object.keys(claims).length
    )
      throw new Error();
    const expiry = (claims as Record<string, unknown>).exp;
    if (
      expiry !== undefined &&
      (typeof expiry !== "number" ||
        !Number.isFinite(expiry) ||
        expiry * 1000 <= Date.now())
    )
      throw new Error();
    return value;
  } catch {
    throw new Error(
      "AI Pro 로그인이 필요하거나 만료되었습니다. openwiki --init에서 AI Pro (Browser SSO)로 다시 로그인하세요.",
    );
  }
}

export function hasAiproToken(value = process.env[AIPRO_TOKEN_KEY]): boolean {
  try {
    readAiproToken(value);
    return true;
  } catch {
    return false;
  }
}

export function readAiproCredential(
  client: AiproProvider,
  value = process.env[
    client === "aipro-cli" ? AIPRO_CLI_TOKEN_KEY : AIPRO_TOKEN_KEY
  ],
): string {
  if (client === "aipro") return readAiproToken(value);
  const token = value?.trim().replace(/^Bearer(?:\s+|$)/i, "") ?? "";
  if (!/^[\x21-\x7e]{1,16384}$/.test(token))
    throw new Error(
      "AI Pro CLI 토큰을 확인하세요. openwiki --init에서 AI Pro CLI를 선택하고 토큰을 입력하세요.",
    );
  return token;
}

async function readJson(response: Response): Promise<unknown> {
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`AI Pro 요청 실패 (HTTP ${response.status}).`);
  }
  if (!response.body) throw new Error("AI Pro 응답이 비어 있습니다.");
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 1024 * 1024)
        throw new Error("AI Pro 응답 크기를 초과했습니다.");
      parts.push(value);
    }
    try {
      return JSON.parse(Buffer.concat(parts).toString());
    } catch {
      throw new Error("AI Pro 응답 형식을 확인할 수 없습니다.");
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function fetchAiproModels(
  token: string,
  options: {
    signal?: AbortSignal;
    fetchImpl?: typeof fetch;
  } = {},
) {
  const response = await (options.fetchImpl ?? fetch)(
    `${AIPRO_ORIGIN}/api/models`,
    {
      headers: {
        Authorization: `Bearer ${readAiproToken(token)}`,
        Accept: "application/json",
        // The AI Pro browser client sends this with model discovery.
        "X-REASONING": "true",
      },
      redirect: "error",
      cache: "no-store",
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(15000)])
        : AbortSignal.timeout(15000),
    },
  );
  const payload = (await readJson(response)) as {
    modelList?: unknown;
    ok?: boolean;
    success?: boolean;
  };
  if (
    !Array.isArray(payload?.modelList) ||
    payload.ok === false ||
    payload.success === false
  )
    throw new Error("AI Pro 모델 목록의 modelList를 확인할 수 없습니다.");
  const seen = new Set<string>();
  const models = payload.modelList
    .filter(
      (item): item is Record<string, unknown> =>
        !!item && typeof item === "object",
    )
    .sort(
      (a, b) =>
        Number(a.sort_seq ?? Number.MAX_SAFE_INTEGER) -
        Number(b.sort_seq ?? Number.MAX_SAFE_INTEGER),
    )
    .flatMap((item) => {
      const id = typeof item.name === "string" ? item.name.trim() : "";
      if (!id || id.length > 200 || hasControl(id) || seen.has(id)) return [];
      seen.add(id);
      const label =
        typeof item.display_name === "string"
          ? item.display_name
              .split("")
              .map((char) => (hasControl(char) ? " " : char))
              .join("")
              .trim()
          : id;
      return [{ id, label: (label || id).slice(0, 200) }];
    });
  if (!models.length)
    throw new Error("AI Pro에서 사용할 수 있는 모델을 반환하지 않았습니다.");
  return models;
}

/** The CLI owns its loopback receiver; it never imports the extension's session. */
export async function loginWithAipro(
  onUrl: (url: string) => void,
  {
    signal,
    fetchImpl = fetch,
    timeoutMs = 180000,
  }: {
    signal?: AbortSignal;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  } = {},
): Promise<string> {
  if (signal?.aborted) throw new Error("AI Pro 로그인을 취소했습니다.");
  const controller = new AbortController();
  let consumed = false;
  let finished = false;
  let callbackResponse: ServerResponse | undefined;
  let resolveResult!: (token: string) => void;
  let rejectResult!: (error: Error) => void;
  const result = new Promise<string>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  // Install the rejection handler before listen/onUrl, which can fail synchronously.
  void result.catch(() => {});
  const fail = (error: Error, state: AiproCallbackState = "error") => {
    if (finished) return;
    finished = true;
    controller.abort();
    void sendAiproCallbackPage(callbackResponse, state).then(() =>
      rejectResult(error),
    );
  };
  const server = createServer((request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.setHeader("Referrer-Policy", "no-referrer");
    const port = (server.address() as AddressInfo).port;
    if (
      ![`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`].includes(
        request.headers.host ?? "",
      )
    ) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    let url: URL;
    try {
      url = new URL(request.url ?? "/", "http://localhost");
    } catch {
      response.writeHead(400).end("Invalid callback");
      return;
    }
    const origin = request.headers.origin;
    if (
      origin &&
      ![AIPRO_ORIGIN, "https://epsso.samsung.net"].includes(origin)
    ) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    if (request.method !== "GET" || url.pathname !== "/auth") {
      response.writeHead(404).end("Not found");
      return;
    }
    if (consumed) {
      response.writeHead(409).end("Login callback already received");
      return;
    }
    const code = url.searchParams.get("code");
    if (
      url.searchParams.get("status") !== "00" ||
      !code ||
      code.length > 16384 ||
      /\s/.test(code) ||
      hasControl(code)
    ) {
      response.writeHead(400).end("Invalid login callback");
      return;
    }
    consumed = true;
    callbackResponse = response;
    void (async () => {
      try {
        const exchange = await fetchImpl(`${AIPRO_ORIGIN}/auth/exchange`, {
          method: "POST",
          redirect: "error",
          cache: "no-store",
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(15000),
          ]),
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          body: new URLSearchParams({ code }).toString(),
        });
        const payload = (await readJson(exchange)) as {
          token?: string;
          ok?: boolean;
          success?: boolean;
        };
        if (controller.signal.aborted || finished) return;
        if (payload?.ok === false || payload?.success === false)
          throw new Error("AI Pro 인증 교환이 거부되었습니다.");
        const token = readAiproToken(payload?.token ?? "");
        finished = true;
        await sendAiproCallbackPage(response, "success");
        resolveResult(token);
      } catch {
        fail(
          new Error(
            "AI Pro 인증 교환에 실패했습니다. 새 로그인으로 다시 시도하세요.",
          ),
        );
      }
    })();
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  const cancel = () => {
    fail(new Error("AI Pro 로그인을 취소했습니다."), "cancelled");
  };
  const timer = setTimeout(() => {
    fail(
      new Error("AI Pro 로그인 시간이 만료되었습니다. 다시 시도하세요."),
      "expired",
    );
  }, timeoutMs);
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.removeListener("error", reject);
        resolve();
      });
    });
    if (signal?.aborted || controller.signal.aborted)
      throw new Error("AI Pro 로그인을 취소했습니다.");
    server.on("error", () =>
      fail(new Error("AI Pro 로그인 수신기에 연결할 수 없습니다.")),
    );
    onUrl(
      `${AIPRO_ORIGIN}/auth/cli/login?port=${(server.address() as AddressInfo).port}`,
    );
    return await result;
  } finally {
    clearTimeout(timer);
    controller.abort();
    signal?.removeEventListener("abort", cancel);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
