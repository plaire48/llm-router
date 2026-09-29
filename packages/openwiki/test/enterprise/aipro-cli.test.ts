import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, expect, test, vi } from "vitest";
import { readAiproCredential } from "../../src/auth/aipro.js";
import { createModel } from "../../src/agent/index.js";
import { resolveStartupCommand } from "../../src/cli/startup.js";
import { buildCredentialEnvUpdates } from "../../src/setup/credentials/persistence.js";
import {
  SELECTABLE_OPENWIKI_PROVIDERS,
  getProviderLabel,
} from "../../src/config/constants.js";

const token = (exp = Date.now() / 1000 + 3600) =>
  `e30.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.test`;
afterEach(() => vi.unstubAllEnvs());

test("AI Pro CLI uses the configured URL, token and model through the compatible transport with AIPROCLI", async () => {
  vi.stubEnv("AIPRO_ACCESS_TOKEN", "invalid-browser-token-must-not-be-used");
  vi.stubEnv("AIPRO_CLI_TOKEN", "Bearer opaque-cli-token");
  vi.stubEnv("OPENAI_COMPATIBLE_API_KEY", "generic-token");
  vi.stubEnv("OPENWIKI_OPENAI_COMPATIBLE_USE_RESPONSES_API", undefined);
  vi.stubEnv("OPENWIKI_OPENAI_COMPATIBLE_STREAMING", undefined);
  vi.stubEnv("OPENWIKI_REASONING_EFFORT", undefined);
  vi.stubEnv("LANGCHAIN_TRACING_V2", "false");
  vi.stubEnv("LANGSMITH_TRACING", "false");
  const observed: {
    url?: string;
    ua?: string;
    authorization?: string;
    body: Record<string, unknown>;
  }[] = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      raw += chunk;
    });
    req.on("end", () => {
      const body = JSON.parse(raw) as Record<string, unknown>;
      observed.push({
        url: req.url,
        ua: req.headers["user-agent"],
        authorization: req.headers.authorization,
        body,
      });
      const reply = {
        id: "synthetic",
        object: body.stream ? "chat.completion.chunk" : "chat.completion",
        created: 0,
        model: body.model,
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            [body.stream ? "delta" : "message"]: {
              role: "assistant",
              content: "ok",
            },
          },
        ],
      };
      res.setHeader(
        "Content-Type",
        body.stream ? "text/event-stream" : "application/json",
      );
      res.end(
        body.stream
          ? `data: ${JSON.stringify(reply)}\n\ndata: [DONE]\n\n`
          : JSON.stringify(reply),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/custom/gateway/v1`;
    vi.stubEnv("AIPRO_CLI_BASE_URL", baseURL);
    vi.stubEnv("OPENAI_COMPATIBLE_BASE_URL", baseURL);
    const tool = {
      type: "function",
      function: {
        name: "echo",
        parameters: {
          type: "object",
          properties: { value: { type: "string" } },
        },
      },
    };
    for (const provider of ["openai-compatible", "aipro-cli"] as const) {
      const response = await createModel(provider, "company-model", 0)
        .bindTools([tool])
        .invoke("hello");
      expect(response.content).toBe("ok");
    }
    let streamed = "";
    for await (const chunk of await createModel(
      "aipro-cli",
      "company-model",
      0,
    ).stream("hello"))
      if (typeof chunk.content === "string") streamed += chunk.content;
    expect(streamed).toBe("ok");
    expect(observed).toHaveLength(3);
    expect(observed[1].body).toEqual(observed[0].body);
    expect(observed[0].ua).not.toBe("AIPROCLI");
    expect(observed[0].authorization).toBe("Bearer generic-token");
    for (const request of observed.slice(1)) {
      expect(request).toMatchObject({
        url: "/custom/gateway/v1/chat/completions",
        ua: "AIPROCLI",
        authorization: "Bearer opaque-cli-token",
        body: { model: "company-model" },
      });
    }
    expect(observed[1].body.tools).toEqual([tool]);
    expect(observed[1].body).not.toHaveProperty("max_tokens");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("selecting AI Pro CLI persists its own token without updating the browser SSO credential", () => {
  const credential = token();
  expect(SELECTABLE_OPENWIKI_PROVIDERS).toContain("aipro-cli");
  expect(getProviderLabel("aipro-cli")).toBe("AI Pro CLI");
  expect(
    buildCredentialEnvUpdates(
      {
        nextProvider: "aipro-cli",
        nextApiKey: credential,
        nextBaseUrl: "https://cli.example.test/custom/v1",
        nextGcpLocation: null,
        nextGcpProject: null,
        nextLangSmithKey: null,
        nextModelId: "model-id",
        nextOAuthTokens: null,
        nextRegion: null,
        nextSecretKey: null,
      },
      { OPENWIKI_PROVIDER: "aipro" },
    ),
  ).toMatchObject({
    OPENWIKI_PROVIDER: "aipro-cli",
    AIPRO_CLI_TOKEN: credential,
    AIPRO_CLI_BASE_URL: "https://cli.example.test/custom/v1",
    OPENWIKI_MODEL_ID: "model-id",
  });
});

test.each([undefined, "", "   "])(
  "CLI startup requires its own token even when browser SSO is logged in",
  async (credential) => {
    vi.stubEnv("OPENWIKI_PROVIDER", "aipro-cli");
    vi.stubEnv("AIPRO_ACCESS_TOKEN", token());
    vi.stubEnv("AIPRO_CLI_TOKEN", credential);
    const command = {
      kind: "run",
      exitCode: 0,
      command: "init",
      dryRun: false,
      modelId: "model-id",
      print: true,
      shouldStart: true,
      userMessage: null,
    } as const;
    const result = await resolveStartupCommand(command, { isStdinTTY: false });
    expect(result).toMatchObject({ kind: "error", exitCode: 1 });
    if (result.kind === "error")
      expect(result.message).toContain("AIPRO_CLI_TOKEN");
  },
);

test("CLI startup accepts a pasted opaque token without browser SSO", async () => {
  vi.stubEnv("OPENWIKI_PROVIDER", "aipro-cli");
  vi.stubEnv("AIPRO_ACCESS_TOKEN", undefined);
  vi.stubEnv("AIPRO_CLI_TOKEN", "opaque-cli-token");
  vi.stubEnv("AIPRO_CLI_BASE_URL", "https://cli.example.test/v1");
  const command = {
    kind: "run",
    exitCode: 0,
    command: "init",
    dryRun: false,
    modelId: "model-id",
    print: true,
    shouldStart: true,
    userMessage: null,
  } as const;
  expect(await resolveStartupCommand(command, { isStdinTTY: false })).toEqual(
    command,
  );
});

test("CLI token validation accepts opaque tokens and rejects empty or invalid headers without exposing them", () => {
  expect(readAiproCredential("aipro-cli", "  Bearer opaque-token  ")).toBe(
    "opaque-token",
  );
  for (const invalid of ["", "Bearer ", "bad token", "secret\nheader"])
    expect(() => readAiproCredential("aipro-cli", invalid)).toThrow(
      "AI Pro CLI 토큰",
    );
});
