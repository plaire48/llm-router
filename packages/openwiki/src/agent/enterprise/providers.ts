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

type StreamedCall = {
  id?: string;
  type?: string;
  function: { name: string; arguments: string };
};

function incompleteStream(): Response {
  return Response.json(
    { error: { message: "model_stream_incomplete", type: "upstream" } },
    { status: 502, headers: { "x-should-retry": "false" } },
  );
}

// Joins an AI Pro event stream into the single reply a non-streaming caller
// expects. Reasoning deltas are not part of that reply and are left out.
async function completeFromStream(response: Response): Promise<Response> {
  const text = await response.text();
  const head: Record<string, unknown> = {};
  const calls = new Map<number, StreamedCall>();
  let content = "";
  let finishReason: unknown = null;
  let usage: unknown;
  let done = false;
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data) continue;
    if (data === "[DONE]") {
      done = true;
      continue;
    }
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return incompleteStream();
    }
    for (const key of ["id", "created", "model"])
      if (head[key] === undefined && event[key] != null) head[key] = event[key];
    if (event.usage) usage = event.usage;
    const choice = (
      event.choices as Record<string, unknown>[] | undefined
    )?.[0];
    if (!choice) continue;
    if (choice.finish_reason != null) finishReason = choice.finish_reason;
    const delta = (choice.delta ?? {}) as Record<string, unknown>;
    if (typeof delta.content === "string") content += delta.content;
    for (const part of (delta.tool_calls ?? []) as Record<string, unknown>[]) {
      const index = typeof part.index === "number" ? part.index : calls.size;
      const call = calls.get(index) ?? {
        function: { name: "", arguments: "" },
      };
      const fn = (part.function ?? {}) as Record<string, unknown>;
      if (typeof part.id === "string") call.id = part.id;
      if (typeof part.type === "string") call.type = part.type;
      if (typeof fn.name === "string") call.function.name += fn.name;
      if (typeof fn.arguments === "string")
        call.function.arguments += fn.arguments;
      calls.set(index, call);
    }
  }
  // A reply cut off before its end must not look like a finished answer.
  if (!done && finishReason === null) return incompleteStream();
  const toolCalls = [...calls.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, call]) => ({ type: "function", ...call }));
  return Response.json({
    id: head.id,
    object: "chat.completion",
    created: head.created,
    model: head.model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content,
          ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: finishReason ?? "stop",
      },
    ],
    ...(usage ? { usage } : {}),
  });
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
    const request: Record<string, unknown> = { ...body };
    const callerStreams = request.stream === true;
    delete request.stream_options;
    // Exactly what the AI Pro browser client sends. Headers the OpenAI SDK
    // adds (User-Agent, X-Stainless-*, Accept) are not forwarded.
    const send = (includeUsage: boolean) =>
      fetchImpl(`${AIPRO_ORIGIN}/api/v1/chat/completions`, {
        method: "POST",
        signal: init?.signal,
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          Authorization: `Bearer ${readAiproToken()}`,
        },
        body: JSON.stringify({
          ...request,
          stream: true,
          ...(includeUsage ? { stream_options: { include_usage: true } } : {}),
        }),
        redirect: "error",
      });
    let response = await send(true);
    if ([400, 422].includes(response.status)) {
      const reason = await response.clone().text();
      // Drop only the optional field the server named. Anything else stays a rejection.
      if (/stream_options|include_usage/i.test(reason)) {
        await response.body?.cancel().catch(() => undefined);
        response = await send(false);
      }
    }
    const streamed = (response.headers.get("Content-Type") ?? "").includes(
      "text/event-stream",
    );
    if (!response.ok || !streamed || callerStreams) return response;
    return completeFromStream(response);
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
