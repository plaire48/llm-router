/* eslint @typescript-eslint/require-await: "off" -- Fetch mocks intentionally resolve without I/O. */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import { createModel } from "../../src/agent/index.js";
import { createFabrixFetch } from "../../src/agent/enterprise/providers.js";
import {
  fabrixCompletion,
  fabrixToolMessage,
  FabrixToolProtocolError,
} from "../../src/agent/enterprise/fabrix.js";

type Body = { systemPrompt: string; contents: string[] };
const readBody = (init?: RequestInit) =>
  JSON.parse(typeof init?.body === "string" ? init.body : "") as Body;
const nonce = (body: Body) =>
  /request_id "([^"]+)"/.exec(body.systemPrompt)?.[1];
const envelope = (
  requestId: string | undefined,
  payload: Record<string, unknown>,
) =>
  JSON.stringify({
    protocol: "aipro-fabrix-tools-v1",
    request_id: requestId,
    ...payload,
  });
const wrapped = (content: string) => `\n\`\`\`json\n${content}\n\`\`\`\n`;
const finalMessage = { type: "message", content: "완료했습니다." };
const echo = {
  type: "function",
  function: {
    name: "echo",
    parameters: {
      type: "object",
      properties: { value: { type: "string" } },
      required: ["value"],
      additionalProperties: false,
    },
  },
};
const toolMessage = {
  type: "tool_calls",
  tool_calls: [{ name: "echo", arguments: { value: "ok" } }],
};
const request = {
  model: "test-model",
  messages: [{ role: "user", content: "Echo ok" }],
  tools: [echo],
};
const connection = {
  endpoint: "https://fabrix.example.test",
  modelId: "test-model",
  clientKey: "synthetic-client",
  token: "synthetic-token",
};
const upstream = (content: string, withUsage = true) =>
  Response.json({
    status: "SUCCESS",
    content,
    ...(withUsage ? { usage: { input_tokens: 20, output_tokens: 5 } } : {}),
  });
beforeEach(() => {
  vi.stubEnv("FABRIX_BASE_URL", connection.endpoint);
  vi.stubEnv("FABRIX_CLIENT_KEY", connection.clientKey);
  vi.stubEnv("FABRIX_API_TOKEN", connection.token);
  vi.stubEnv("LANGCHAIN_TRACING_V2", "false");
  vi.stubEnv("LANGSMITH_TRACING", "false");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("FabriX generation protocol recovery", () => {
  test("accepts one fenced envelope with Markdown inside arguments", () => {
    const text = "# Wiki\n```ts\nconst value = 1;\n```\n";
    const message = fabrixToolMessage(
      wrapped(
        envelope("current", {
          type: "tool_calls",
          tool_calls: [{ name: "echo", arguments: { value: text } }],
        }),
      ),
      "current",
      [echo],
    ) as { tool_calls: { function: { arguments: string } }[] };
    expect(JSON.parse(message.tool_calls[0].function.arguments)).toEqual({
      value: text,
    });
  });

  test.each([
    [
      "prose",
      `Here is the response: ${envelope("current", finalMessage)}`,
      "invalid_json",
    ],
    [
      "two objects",
      `${envelope("current", finalMessage)}\n${envelope("current", toolMessage)}`,
      "invalid_json",
    ],
    [
      "reasoning",
      `<think>private reasoning</think>${envelope("current", finalMessage)}`,
      "invalid_json",
    ],
    ["wrong protocol", '{"protocol":"other"}', "invalid_protocol"],
    [
      "stale fenced ID",
      wrapped(envelope("old", toolMessage)),
      "request_id_mismatch",
    ],
    ["missing ID", envelope(undefined, toolMessage), "request_id_mismatch"],
    [
      "unknown tool",
      envelope("current", {
        type: "tool_calls",
        tool_calls: [{ name: "secret-command", arguments: {} }],
      }),
      "unknown_tool",
    ],
    [
      "invalid arguments",
      envelope("current", {
        type: "tool_calls",
        tool_calls: [{ name: "echo", arguments: { value: 3 } }],
      }),
      "invalid_arguments",
    ],
    [
      "mixed answer and tools",
      envelope("current", { ...toolMessage, content: "done" }),
      "invalid_envelope",
    ],
  ])("rejects %s without exposing response content", (_label, text, reason) => {
    try {
      fabrixToolMessage(text, "current", [echo]);
      expect.fail("Invalid response became executable");
    } catch (cause) {
      expect(cause).toBeInstanceOf(FabrixToolProtocolError);
      expect(cause).toMatchObject({ reason, status: 400 });
      expect(String(cause)).not.toContain(text);
      expect(String(cause)).not.toContain("secret-command");
    }
  });

  test("regenerates once with a fresh nonce, no failed output, and cumulative usage", async () => {
    const bodies: Body[] = [];
    const measurements: unknown[] = [];
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = readBody(init);
      bodies.push(body);
      return upstream(
        bodies.length === 1
          ? "sensitive malformed response"
          : envelope(nonce(body), toolMessage),
      );
    });
    const response = await fabrixCompletion(request, connection, {
      fetchImpl,
      onMeasurement: (usage) => {
        measurements.push(usage);
      },
    });
    const payload = (await response.json()) as {
      usage: { total_tokens: number };
      choices: { message: { tool_calls: unknown[] } }[];
    };
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(nonce(bodies[1])).not.toBe(nonce(bodies[0]));
    expect(bodies[1].systemPrompt).toContain("invalid_json");
    expect(bodies[1].systemPrompt).toContain("No tool was executed");
    expect(JSON.stringify(bodies[1])).not.toContain(
      "sensitive malformed response",
    );
    expect(payload.choices[0].message.tool_calls).toHaveLength(1);
    expect(payload.usage.total_tokens).toBe(50);
    expect(measurements).toEqual([
      { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 },
      { prompt_tokens: 40, completion_tokens: 10, total_tokens: 50 },
    ]);
  });

  test("does not present a complete usage total when the discarded attempt has none", async () => {
    let count = 0;
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) =>
      ++count === 1
        ? upstream("malformed", false)
        : upstream(envelope(nonce(readBody(init)), finalMessage)),
    );
    const response = await fabrixCompletion(request, connection, { fetchImpl });
    expect(await response.json()).not.toHaveProperty("usage");
  });

  test("LangChain default retries stop after two invalid model responses", async () => {
    const fetchImpl = vi.fn(async () =>
      upstream("sensitive malformed response"),
    );
    vi.stubGlobal("fetch", fetchImpl);
    const model = createModel("fabrix", "test-model").bindTools([echo]);
    await expect(
      model.invoke([new HumanMessage("Echo ok")]),
    ).rejects.toMatchObject({
      status: 400,
      code: "fabrix_tool_protocol",
      type: "model_response_error",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test("generation with Markdown instructions, a tool result and fenced final answer", async () => {
    let count = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        const body = readBody(init);
        expect(body.systemPrompt).toContain(
          "never to the outer transport envelope",
        );
        if (++count === 1)
          return upstream(
            "# Plain Markdown\nA document, without the transport wrapper.",
          );
        if (count === 2)
          return upstream(wrapped(envelope(nonce(body), toolMessage)));
        expect(body.contents[0]).toContain('"role":"tool"');
        return upstream(wrapped(envelope(nonce(body), finalMessage)));
      }),
    );
    const messages = [
      new SystemMessage(
        "Write the wiki in Markdown. Return only the document.",
      ),
      new HumanMessage("Echo ok before writing"),
    ];
    const model = createModel("fabrix", "test-model").bindTools([echo]);
    const first = await model.invoke(messages);
    expect(first.tool_calls?.[0].args).toEqual({ value: "ok" });
    let text = "";
    for await (const chunk of await model.stream([
      ...messages,
      first,
      new ToolMessage({
        content: "ok",
        tool_call_id: first.tool_calls![0].id!,
      }),
    ])) {
      if (typeof chunk.content === "string") text += chunk.content;
    }
    expect(text).toBe(finalMessage.content);
    expect(count).toBe(3);
  });

  test("abort after a rejected reply prevents the repair request", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn(async () => upstream("malformed"));
    await expect(
      fabrixCompletion(request, connection, {
        fetchImpl,
        signal: controller.signal,
        onMeasurement: () => controller.abort(),
      }),
    ).rejects.toThrow("cancelled");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("stream END output limit is preserved and does not trigger a format retry", async () => {
    const frames = [
      { status: "SUCCESS", eventStatus: "CHUNK", content: '{"protocol":' },
      { status: "SUCCESS", eventStatus: "END", finishReason: "length" },
    ];
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("") +
            "data: [DONE]\n\n",
          { headers: { "Content-Type": "text/event-stream" } },
        ),
    );
    await expect(
      fabrixCompletion({ ...request, stream: true }, connection, { fetchImpl }),
    ).rejects.toThrow("output_limit");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("SDK-facing diagnostics contain a reason and never the upstream content", async () => {
    const fetchImpl = vi.fn(async () =>
      upstream("sensitive malformed response"),
    );
    const response = await createFabrixFetch(fetchImpl)(
      "https://fabrix.openwiki.invalid/v1/chat/completions",
      { method: "POST", body: JSON.stringify(request) },
    );
    expect(response.status).toBe(400);
    expect(response.headers.get("x-should-retry")).toBe("false");
    const text = await response.text();
    expect(text).toContain("invalid_json");
    expect(text).not.toContain("sensitive malformed response");
    expect(text).not.toContain(connection.token);
    expect(text).not.toContain(connection.clientKey);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test("ordinary text requests without tools need no envelope and no retry", async () => {
    const fetchImpl = vi.fn(async () => upstream("Plain text"));
    const response = await fabrixCompletion(
      { ...request, tool_choice: "none" },
      connection,
      { fetchImpl },
    );
    expect(await response.text()).toContain("Plain text");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
