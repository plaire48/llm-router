/* eslint @typescript-eslint/require-await: "off" -- Fetch and credential mocks intentionally resolve without I/O. */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { HumanMessage, ToolMessage } from "@langchain/core/messages";
import { createModel } from "../../src/agent/index.js";
import {
  createAiproFetch,
  createFabrixFetch,
} from "../../src/agent/enterprise/providers.js";
import { testFabrixConnection } from "../../src/agent/enterprise/fabrix.js";

type WireBody = {
  model: string;
  stream?: boolean;
  tools?: unknown[];
  max_tokens?: number;
  contents: string[];
  modelIds: string[];
  systemPrompt: string;
};
const requestBody = (init?: RequestInit): WireBody =>
  JSON.parse(typeof init?.body === "string" ? init.body : "") as WireBody;
type WireReply = {
  choices: { message: { tool_calls: { function: { name: string } }[] } }[];
  usage: { total_tokens: number };
};
const token = `e30.${Buffer.from(JSON.stringify({ exp: Date.now() / 1000 + 3600 })).toString("base64url")}.test`;
const echo = {
  type: "function",
  function: {
    name: "echo",
    description: "Echo value",
    parameters: {
      type: "object",
      properties: { value: { type: "string" } },
      required: ["value"],
      additionalProperties: false,
    },
  },
};
const request = {
  model: "test-model",
  messages: [{ role: "user", content: "hello" }],
  tools: [echo],
};
const endpoint = "https://fabrix.openwiki.invalid/v1/chat/completions";
const aiproEndpoint = "https://aipro.sdsdev.co.kr/api/v1/chat/completions";
// The exact headers the AI Pro browser client sets. Nothing else may be added.
const aiproChatHeaders = {
  accept: "text/event-stream",
  authorization: `Bearer ${token}`,
  "content-type": "application/json",
};
const sentHeaders = (init?: RequestInit) =>
  Object.fromEntries(new Headers(init?.headers).entries());
// What the OpenAI SDK attaches to every request it builds.
const sdkHeaders = {
  Accept: "application/json",
  Authorization: "Bearer openwiki-managed-credential",
  "User-Agent": "langchainjs-openai/1.0.0 ((node/v25.4.0; darwin; arm64))",
  "X-Stainless-Arch": "arm64",
  "X-Stainless-Lang": "js",
  "X-Stainless-OS": "MacOS",
  "X-Stainless-Package-Version": "7.8.0",
  "X-Stainless-Retry-Count": "0",
  "X-Stainless-Runtime": "node",
  "X-Stainless-Runtime-Version": "v25.4.0",
};
const sse = (events: unknown[], { done = true } = {}) =>
  new Response(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") +
      (done ? "data: [DONE]\n\n" : ""),
    { headers: { "Content-Type": "text/event-stream; charset=utf-8" } },
  );
const chunk = (delta: unknown, extra: Record<string, unknown> = {}) => ({
  id: "chatcmpl-1",
  object: "chat.completion.chunk",
  created: 1,
  model: "test-model",
  choices: [{ index: 0, delta, finish_reason: null }],
  ...extra,
});
beforeEach(() => {
  vi.stubEnv("AIPRO_ACCESS_TOKEN", token);
  vi.stubEnv("AIPRO_CLI_TOKEN", "synthetic-cli-token");
  vi.stubEnv("AIPRO_CLI_BASE_URL", "https://cli.example.test/custom/v1");
  vi.stubEnv("FABRIX_BASE_URL", "https://fabrix.example.test");
  vi.stubEnv("FABRIX_CLIENT_KEY", "synthetic-client");
  vi.stubEnv("FABRIX_API_TOKEN", "synthetic-token");
  vi.stubEnv("OPENWIKI_REASONING_EFFORT", undefined);
  vi.stubEnv("LANGCHAIN_TRACING_V2", "false");
  vi.stubEnv("LANGSMITH_TRACING", "false");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function reply(
  body: Record<string, unknown>,
  content: Record<string, unknown>,
) {
  const prompt = String(body.systemPrompt);
  const nonce = /request_id "([^"]+)"/.exec(prompt)?.[1];
  return Response.json({
    status: "SUCCESS",
    content: JSON.stringify({
      protocol: "aipro-fabrix-tools-v1",
      request_id: nonce,
      ...content,
    }),
    usage: { input_tokens: 20, output_tokens: 5 },
  });
}

describe("enterprise model transports", () => {
  test("AI Pro uses the current bearer token and chat completions with tools", async () => {
    const fetchImpl = vi.fn(async (url: unknown, init?: RequestInit) => {
      expect(url).toBe("https://aipro.sdsdev.co.kr/api/v1/chat/completions");
      expect(sentHeaders(init)).toEqual(aiproChatHeaders);
      expect(requestBody(init).stream).toBe(true);
      expect(requestBody(init).tools).toEqual([echo]);
      expect(requestBody(init).max_tokens).toBe(100);
      expect(init?.redirect).toBe("error");
      return Response.json({ choices: [] });
    });
    await createAiproFetch(fetchImpl)(
      "https://aipro.sdsdev.co.kr/api/v1/chat/completions",
      {
        method: "POST",
        body: JSON.stringify({ ...request, max_completion_tokens: 100 }),
      },
    );
    await expect(
      createAiproFetch(fetchImpl)("https://other.example/chat/completions", {
        method: "POST",
        body: "{}",
      }),
    ).rejects.toThrow("Unsupported");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("AI Pro sends only the browser client headers even when the SDK supplies its own", async () => {
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      expect(sentHeaders(init)).toEqual(aiproChatHeaders);
      const body = requestBody(init) as WireBody & {
        stream_options?: unknown;
      };
      expect(body.stream).toBe(true);
      expect(body.stream_options).toEqual({ include_usage: true });
      return sse([chunk({ role: "assistant", content: "ok" })]);
    });
    await createAiproFetch(fetchImpl)(aiproEndpoint, {
      method: "POST",
      headers: sdkHeaders,
      body: JSON.stringify({ ...request, stream: false }),
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("AI Pro returns one completed reply to a caller that did not ask for a stream", async () => {
    const fetchImpl = vi.fn(async () =>
      sse([
        chunk({ role: "assistant", content: "" }),
        chunk({ reasoning_content: "thinking" }),
        chunk({ content: "안녕" }),
        chunk({ content: "하세요" }),
        chunk({
          tool_calls: [
            {
              index: 0,
              id: "call_1",
              type: "function",
              function: { name: "echo", arguments: '{"val' },
            },
          ],
        }),
        chunk({
          tool_calls: [{ index: 0, function: { arguments: 'ue":"a"}' } }],
        }),
        chunk({
          tool_calls: [
            {
              index: 1,
              id: "call_2",
              type: "function",
              function: { name: "echo", arguments: "{}" },
            },
          ],
        }),
        {
          ...chunk({}),
          choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
        },
        {
          ...chunk({}),
          choices: [],
          usage: {
            prompt_tokens: 11,
            completion_tokens: 4,
            total_tokens: 15,
            prompt_tokens_details: { cached_tokens: 3 },
          },
        },
      ]),
    );
    const response = await createAiproFetch(fetchImpl)(aiproEndpoint, {
      method: "POST",
      headers: sdkHeaders,
      body: JSON.stringify(request),
    });
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(await response.json()).toEqual({
      id: "chatcmpl-1",
      object: "chat.completion",
      created: 1,
      model: "test-model",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "안녕하세요",
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "echo", arguments: '{"value":"a"}' },
              },
              {
                id: "call_2",
                type: "function",
                function: { name: "echo", arguments: "{}" },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: {
        prompt_tokens: 11,
        completion_tokens: 4,
        total_tokens: 15,
        prompt_tokens_details: { cached_tokens: 3 },
      },
    });
  });

  test("AI Pro passes a stream through to a caller that asked for one", async () => {
    const fetchImpl = vi.fn(async () => sse([chunk({ content: "a" })]));
    const response = await createAiproFetch(fetchImpl)(aiproEndpoint, {
      method: "POST",
      body: JSON.stringify({ ...request, stream: true }),
    });
    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    expect(await response.text()).toContain('"content":"a"');
  });

  test("AI Pro keeps rejections and plain JSON replies unchanged", async () => {
    const rejected = await createAiproFetch(
      vi.fn(async () =>
        Response.json({ error: { message: "expired" } }, { status: 401 }),
      ),
    )(aiproEndpoint, { method: "POST", body: JSON.stringify(request) });
    expect(rejected.status).toBe(401);
    expect(await rejected.json()).toEqual({ error: { message: "expired" } });
    const plain = await createAiproFetch(
      vi.fn(async () => Response.json({ choices: [], model: "test-model" })),
    )(aiproEndpoint, { method: "POST", body: JSON.stringify(request) });
    expect(await plain.json()).toEqual({ choices: [], model: "test-model" });
  });

  test("AI Pro retries once without the usage option only when the server rejects that option", async () => {
    const bodies: WireBody[] = [];
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      bodies.push(requestBody(init));
      return bodies.length === 1
        ? Response.json(
            { error: { message: "Unknown field: stream_options" } },
            { status: 400 },
          )
        : sse([chunk({ role: "assistant", content: "ok" })]);
    });
    const response = await createAiproFetch(fetchImpl)(aiproEndpoint, {
      method: "POST",
      body: JSON.stringify(request),
    });
    expect(response.status).toBe(200);
    expect(bodies.map((body) => "stream_options" in body)).toEqual([
      true,
      false,
    ]);
    const other = vi.fn(async () =>
      Response.json({ error: { message: "model not found" } }, { status: 400 }),
    );
    expect(
      (
        await createAiproFetch(other)(aiproEndpoint, {
          method: "POST",
          body: JSON.stringify(request),
        })
      ).status,
    ).toBe(400);
    expect(other).toHaveBeenCalledTimes(1);
  });

  test("AI Pro reports a stream that ends before it is complete", async () => {
    const fetchImpl = vi.fn(async () =>
      sse([chunk({ content: "partial" })], { done: false }),
    );
    const response = await createAiproFetch(fetchImpl)(aiproEndpoint, {
      method: "POST",
      body: JSON.stringify(request),
    });
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: { message: "model_stream_incomplete", type: "upstream" },
    });
  });

  test("FabriX converts headers, tool calls, results, usage and streaming", async () => {
    const fetchImpl = vi.fn(async (url: unknown, init?: RequestInit) => {
      expect(url).toBe("https://fabrix.example.test/openapi/chat/v1/messages");
      expect(new Headers(init?.headers).get("x-fabrix-client")).toBe(
        "synthetic-client",
      );
      expect(new Headers(init?.headers).get("x-openapi-token")).toBe(
        "Bearer synthetic-token",
      );
      expect(new Headers(init?.headers).get("Authorization")).toBeNull();
      const body = requestBody(init);
      expect(body.modelIds).toEqual(["test-model"]);
      return reply(body, {
        type: "tool_calls",
        tool_calls: [{ name: "echo", arguments: { value: "ok" } }],
      });
    });
    const response = await createFabrixFetch(fetchImpl)(endpoint, {
      method: "POST",
      body: JSON.stringify(request),
    });
    const payload = (await response.json()) as WireReply;
    expect(payload.choices[0].message.tool_calls[0].function.name).toBe("echo");
    expect(payload.usage.total_tokens).toBe(25);
    const streamed = await createFabrixFetch(fetchImpl)(endpoint, {
      method: "POST",
      body: JSON.stringify({ ...request, stream: true }),
    });
    expect(await streamed.text()).toContain("data: [DONE]");
  });

  test.each([
    { type: "tool_calls", tool_calls: [{ name: "unknown", arguments: {} }] },
    {
      type: "tool_calls",
      tool_calls: [{ name: "echo", arguments: { value: 123 } }],
    },
    {
      type: "tool_calls",
      tool_calls: [{ name: "echo", arguments: { value: "ok", extra: true } }],
    },
    { type: "message", content: "hello", request_id: "stale-nonce" },
  ])(
    "rejects invalid tool envelopes before they reach the executor: %j",
    async (content) => {
      const response = await createFabrixFetch(
        vi.fn(async (_url: unknown, init?: RequestInit) =>
          reply(requestBody(init), content),
        ),
      )(endpoint, { method: "POST", body: JSON.stringify(request) });
      expect(response.status).toBe(400);
      expect(await response.text()).toContain("fabrix_tool_protocol");
    },
  );

  test("real LangChain model bindTools executes the FabriX two-round contract", async () => {
    let round = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        const body = requestBody(init);
        if (++round === 1)
          return reply(body, {
            type: "tool_calls",
            tool_calls: [{ name: "echo", arguments: { value: "done" } }],
          });
        expect(body.contents[0]).toContain('"role":"tool"');
        expect(body.contents[0]).toContain("done");
        return reply(body, { type: "message", content: "finished" });
      }),
    );
    const model = createModel("fabrix", "test-model", 0).bindTools([echo]);
    const first = await model.invoke([new HumanMessage("Echo done")]);
    expect(first.tool_calls?.[0].args).toEqual({ value: "done" });
    const second = await model.invoke([
      new HumanMessage("Echo done"),
      first,
      new ToolMessage({
        content: "done",
        tool_call_id: first.tool_calls![0].id!,
      }),
    ]);
    expect(second.content).toBe("finished");
    expect(round).toBe(2);
  });

  test.each(["aipro", "aipro-cli"] as const)(
    "real %s model preserves model names, tool calls, results and SSE",
    async (provider) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: unknown, init?: RequestInit) => {
          expect(_url).toBe(
            provider === "aipro-cli"
              ? "https://cli.example.test/custom/v1/chat/completions"
              : "https://aipro.sdsdev.co.kr/api/v1/chat/completions",
          );
          const body = requestBody(init);
          expect(body.model).toBe("GLM-5.2-NVFP4");
          const ua = new Headers(init?.headers).get("User-Agent");
          if (provider === "aipro-cli") expect(ua).toBe("AIPROCLI");
          else expect(ua).not.toBe("AIPROCLI");
          expect(body).not.toHaveProperty("systemPrompt");
          expect(body).not.toHaveProperty("contents");
          expect(new Headers(init?.headers).get("Authorization")).toBe(
            `Bearer ${provider === "aipro-cli" ? "synthetic-cli-token" : token}`,
          );
          // AI Pro is always asked for a stream, like the browser client.
          // The first turn has no tool result yet and must call the tool.
          const wire = body as unknown as {
            messages: { role: string }[];
            stream?: boolean;
          };
          if (provider === "aipro") {
            expect(wire.stream).toBe(true);
            expect(sentHeaders(init)).toEqual(aiproChatHeaders);
          }
          const firstTurn = !wire.messages.some(
            (message) => message.role === "tool",
          );
          if (provider === "aipro" && firstTurn)
            return new Response(
              `data: ${JSON.stringify({
                id: "synthetic",
                object: "chat.completion.chunk",
                created: 0,
                model: body.model,
                choices: [
                  {
                    index: 0,
                    delta: {
                      role: "assistant",
                      tool_calls: [
                        {
                          index: 0,
                          id: "call_test",
                          type: "function",
                          function: {
                            name: "echo",
                            arguments: '{"value":"done"}',
                          },
                        },
                      ],
                    },
                    finish_reason: "tool_calls",
                  },
                ],
              })}\n\ndata: [DONE]\n\n`,
              { headers: { "Content-Type": "text/event-stream" } },
            );
          if (body.stream) {
            const chunk = {
              id: "synthetic",
              object: "chat.completion.chunk",
              created: 0,
              model: body.model,
              choices: [
                {
                  index: 0,
                  delta: { role: "assistant", content: "streamed" },
                  finish_reason: "stop",
                },
              ],
            };
            return new Response(
              `data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`,
              { headers: { "Content-Type": "text/event-stream" } },
            );
          }
          return Response.json({
            id: "synthetic",
            object: "chat.completion",
            created: 0,
            model: body.model,
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: null,
                  tool_calls: [
                    {
                      id: "call_test",
                      type: "function",
                      function: { name: "echo", arguments: '{"value":"done"}' },
                    },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
          });
        }),
      );
      const model = createModel(provider, "GLM-5.2-NVFP4", 0).bindTools([echo]);
      const answer = await model.invoke([new HumanMessage("Echo done")]);
      expect(answer.tool_calls?.[0].args).toEqual({ value: "done" });
      let result = "";
      for await (const chunk of await model.stream([
        new HumanMessage("Echo done"),
        answer,
        new ToolMessage({ content: "done", tool_call_id: "call_test" }),
      ]))
        if (typeof chunk.content === "string") result += chunk.content;
      expect(result).toBe("streamed");
    },
  );

  test("connection verification needs both an echo call and its follow-up answer", async () => {
    let round = 0;
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = requestBody(init);
      const value =
        round++ === 0
          ? /value ([a-f0-9-]+)\./.exec(body.contents[0])?.[1]
          : /\\"value\\":\\"([a-f0-9-]+)\\"/.exec(body.contents[0])?.[1];
      return reply(
        body,
        round === 1
          ? {
              type: "tool_calls",
              tool_calls: [{ name: "connection_echo", arguments: { value } }],
            }
          : { type: "message", content: value },
      );
    });
    const connection = {
      endpoint: "https://fabrix.example.test",
      modelId: "test-model",
      clientKey: "test",
      token: "test",
      maxOutputTokens: 512,
    };
    expect(await testFabrixConnection(connection, { fetchImpl })).toEqual({
      response: true,
      tools: true,
      status: 200,
    });
    expect(round).toBe(2);
  });

  test("FabriX requires HTTPS, rejects images, and preserves upstream status", async () => {
    vi.stubEnv("FABRIX_BASE_URL", "http://fabrix.example.test");
    await expect(
      createFabrixFetch()(endpoint, {
        method: "POST",
        body: JSON.stringify(request),
      }),
    ).rejects.toThrow("fabrix_endpoint");
    vi.stubEnv("FABRIX_BASE_URL", "https://fabrix.example.test");
    const images = await createFabrixFetch()(endpoint, {
      method: "POST",
      body: JSON.stringify({
        ...request,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: "https://example.test/image.png" },
              },
            ],
          },
        ],
      }),
    });
    expect(images.status).toBe(502);
    expect(await images.text()).toContain("fabrix_media_unsupported");
    const upstream = vi.fn(
      async () => new Response("secret upstream body", { status: 401 }),
    );
    const response = await createFabrixFetch(upstream)(endpoint, {
      method: "POST",
      body: JSON.stringify(request),
    });
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain("secret upstream body");
  });
});
