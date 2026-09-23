import { AIPRO_ORIGIN, readAiproToken } from "../../auth/aipro.js";
import {
  cleanFabrixConnection,
  fabrixCompletion,
  FabrixToolProtocolError,
} from "./fabrix.js";

function parseRequest(
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
  expected: string,
) {
  const url = input instanceof Request ? input.url : String(input);
  if (
    url !== expected ||
    init?.method !== "POST" ||
    typeof init.body !== "string"
  ) {
    throw new Error("Unsupported enterprise provider request");
  }
  const parsed: unknown = JSON.parse(init.body);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Invalid enterprise request");
  const body = parsed as Record<string, unknown>;
  if (typeof body.model !== "string")
    throw new Error("Missing enterprise model");
  // Some model names trigger LangChain's OpenAI-specific token spelling.
  if (body.max_completion_tokens != null) {
    body.max_tokens = body.max_completion_tokens;
    delete body.max_completion_tokens;
  }
  return { ...body, model: body.model };
}

export function createAiproFetch(
  fetchImpl: typeof fetch = globalThis.fetch,
): typeof fetch {
  return async (input, init) => {
    const body = parseRequest(
      input,
      init,
      `${AIPRO_ORIGIN}/api/v1/chat/completions`,
    );
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${readAiproToken()}`);
    headers.set("Content-Type", "application/json");
    return fetchImpl(`${AIPRO_ORIGIN}/api/v1/chat/completions`, {
      ...init,
      headers,
      body: JSON.stringify(body),
      redirect: "error",
    });
  };
}

export function createFabrixFetch(
  fetchImpl: typeof fetch = globalThis.fetch,
): typeof fetch {
  return async (input, init) => {
    const body = parseRequest(
      input,
      init,
      "https://fabrix.openwiki.invalid/v1/chat/completions",
    );
    const connection = cleanFabrixConnection({
      endpoint: process.env.FABRIX_BASE_URL,
      modelId: body.model,
      clientKey: process.env.FABRIX_CLIENT_KEY,
      token: process.env.FABRIX_API_TOKEN,
    });
    try {
      return await fabrixCompletion(body, connection, {
        signal: init?.signal ?? undefined,
        fetchImpl,
      });
    } catch (cause) {
      // Never include upstream bodies, keys or prompts in SDK/CLI errors.
      if (cause instanceof FabrixToolProtocolError) {
        return Response.json(
          {
            error: {
              message: `FabriX: ${cause.message} 형식을 한 번 재요청했지만 검증에 실패했습니다. 선택한 모델의 도구 응답 지원을 확인하세요.`,
              type: "model_response_error",
              code: "fabrix_tool_protocol",
              reason: cause.reason,
            },
          },
          { status: cause.status, headers: { "x-should-retry": "false" } },
        );
      }
      const error = cause as Error & { status?: number };
      const message = `FabriX: ${error.message}`;
      return Response.json(
        { error: { message, type: "provider_error", code: error.message } },
        { status: error.status ?? 502 },
      );
    }
  };
}
