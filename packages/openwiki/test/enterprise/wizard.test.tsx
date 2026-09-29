/* eslint @typescript-eslint/require-await: "off" -- Fetch and credential mocks intentionally resolve without I/O. */
import React from "react";
import { render, cleanup } from "ink-testing-library";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { InitSetup } from "../../src/setup/credentials.js";
import { saveOpenWikiEnv } from "../../src/config/env.js";
import { fetchAiproModels, loginWithAipro } from "../../src/auth/aipro.js";
import {
  testFabrixConnection,
  FabrixToolProtocolError,
} from "../../src/agent/enterprise/fabrix.js";
import { stripAnsi } from "../cli/components/ansi.js";

vi.mock("../../src/setup/onboarding.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/setup/onboarding.js")>();
  return {
    ...actual,
    readOpenWikiOnboardingConfig: vi.fn(async () =>
      actual.createEmptyOnboardingConfig(),
    ),
    saveOpenWikiOnboardingConfig: vi.fn(async () => {}),
  };
});
vi.mock("../../src/config/env.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/config/env.js")>();
  return { ...actual, saveOpenWikiEnv: vi.fn(async () => {}) };
});
vi.mock("../../src/auth/aipro.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/auth/aipro.js")>();
  return { ...actual, loginWithAipro: vi.fn(), fetchAiproModels: vi.fn() };
});
vi.mock("../../src/agent/enterprise/fabrix.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../src/agent/enterprise/fabrix.js")
    >();
  return { ...actual, testFabrixConnection: vi.fn() };
});

const token = `e30.${Buffer.from(JSON.stringify({ exp: Date.now() / 1000 + 3600 })).toString("base64url")}.test`;
beforeEach(() => {
  for (const key of [
    "OPENWIKI_PROVIDER",
    "OPENWIKI_MODEL_ID",
    "AIPRO_ACCESS_TOKEN",
    "AIPRO_CLI_TOKEN",
    "AIPRO_CLI_BASE_URL",
    "FABRIX_API_TOKEN",
    "FABRIX_CLIENT_KEY",
    "FABRIX_BASE_URL",
    "LANGSMITH_API_KEY",
    "OPENWIKI_REASONING_EFFORT",
  ])
    vi.stubEnv(key, undefined);
  vi.stubEnv("LANGCHAIN_TRACING_V2", "false");
  vi.mocked(loginWithAipro).mockResolvedValue(token);
  vi.mocked(fetchAiproModels).mockResolvedValue([
    { id: "GLM-5.2-NVFP4", label: "GLM live catalog" },
    { id: "model-agent", label: "Agent model" },
  ]);
  vi.mocked(testFabrixConnection).mockResolvedValue({
    response: true,
    tools: true,
    status: 200,
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

async function waitForText(lastFrame: () => string | undefined, text: string) {
  await vi.waitFor(() => expect(stripAnsi(lastFrame())).toContain(text), {
    timeout: 3000,
    interval: 10,
  });
}
const mount = () =>
  render(
    <InitSetup
      mode="code"
      allowModeSelection={false}
      walkAllSteps={false}
      onComplete={vi.fn()}
      onError={vi.fn()}
    />,
  );

describe("enterprise setup wizard", () => {
  test("AI Pro CLI collects URL, token and model manually without discovery or SSO", async () => {
    vi.stubEnv("OPENWIKI_PROVIDER", "aipro-cli");
    vi.stubEnv("AIPRO_ACCESS_TOKEN", token);
    const ui = mount();
    await waitForText(ui.lastFrame, "base URL");
    await new Promise((resolve) => setTimeout(resolve, 20));
    ui.stdin.write("https://cli.example.test/custom/v1");
    await new Promise((resolve) => setTimeout(resolve, 20));
    ui.stdin.write("\r");
    await waitForText(ui.lastFrame, "AI Pro CLI token");
    expect(loginWithAipro).not.toHaveBeenCalled();
    expect(fetchAiproModels).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 20));
    ui.stdin.write("synthetic-cli-token");
    await new Promise((resolve) => setTimeout(resolve, 20));
    ui.stdin.write("\r");
    await waitForText(ui.lastFrame, "model ID");
    expect(fetchAiproModels).not.toHaveBeenCalled();
    ui.stdin.write("custom-model-id");
    await new Promise((resolve) => setTimeout(resolve, 20));
    ui.stdin.write("\r");
    await vi.waitFor(() => expect(saveOpenWikiEnv).toHaveBeenCalled());
    const updates = vi.mocked(saveOpenWikiEnv).mock.calls.at(-1)?.[0];
    expect(updates).toMatchObject({
      AIPRO_CLI_TOKEN: "synthetic-cli-token",
      AIPRO_CLI_BASE_URL: "https://cli.example.test/custom/v1",
      OPENWIKI_MODEL_ID: "custom-model-id",
    });
    expect(updates).not.toHaveProperty("AIPRO_ACCESS_TOKEN");
    expect(updates).not.toHaveProperty("OPENAI_CHATGPT_ACCESS_TOKEN");
    expect(loginWithAipro).not.toHaveBeenCalled();
    expect(stripAnsi(ui.lastFrame())).not.toContain("synthetic-cli-token");
  });
  test.each(["aipro"] as const)(
    "%s SSO reaches discovered models and persists only the AI Pro credential",
    async (provider) => {
      vi.stubEnv("OPENWIKI_PROVIDER", provider);
      const ui = mount();
      await waitForText(ui.lastFrame, "GLM live catalog");
      await vi.waitFor(() => expect(fetchAiproModels).toHaveBeenCalledTimes(2));
      expect(loginWithAipro).toHaveBeenCalledWith(
        expect.any(Function),
        expect.any(Object),
      );
      expect(fetchAiproModels).toHaveBeenCalledWith(token, expect.any(Object));
      await new Promise((resolve) => setTimeout(resolve, 20));
      ui.stdin.write("\r");
      await vi.waitFor(() => expect(saveOpenWikiEnv).toHaveBeenCalled());
      const updates = vi.mocked(saveOpenWikiEnv).mock.calls.at(-1)?.[0];
      expect(updates).toMatchObject({
        AIPRO_ACCESS_TOKEN: token,
        OPENWIKI_MODEL_ID: "GLM-5.2-NVFP4",
      });
      expect(updates).not.toHaveProperty("OPENAI_CHATGPT_ACCESS_TOKEN");
      expect(stripAnsi(ui.lastFrame())).not.toContain(token);
    },
  );

  test.each(["aipro"] as const)(
    "%s re-entry with a valid token reloads the model catalog without SSO",
    async (provider) => {
      vi.stubEnv("OPENWIKI_PROVIDER", provider);
      const credential = token;
      vi.stubEnv("AIPRO_ACCESS_TOKEN", credential);
      const ui = mount();
      await waitForText(ui.lastFrame, "GLM live catalog");
      expect(loginWithAipro).not.toHaveBeenCalled();
      expect(fetchAiproModels).toHaveBeenCalledWith(
        credential,
        expect.any(Object),
      );
    },
  );

  test("CLI re-entry reuses its URL and token and accepts any manually entered model without network discovery", async () => {
    vi.stubEnv("OPENWIKI_PROVIDER", "aipro-cli");
    vi.stubEnv("AIPRO_CLI_BASE_URL", "https://cli.example.test/v1");
    vi.stubEnv("AIPRO_CLI_TOKEN", "synthetic-cli-token");
    vi.mocked(fetchAiproModels).mockRejectedValue(new Error("offline"));
    const ui = mount();
    await waitForText(ui.lastFrame, "model ID");
    ui.stdin.write("model-offline");
    await new Promise((resolve) => setTimeout(resolve, 20));
    ui.stdin.write("\r");
    await vi.waitFor(() => expect(saveOpenWikiEnv).toHaveBeenCalled());
    expect(vi.mocked(saveOpenWikiEnv).mock.calls.at(-1)?.[0]).toMatchObject({
      OPENWIKI_MODEL_ID: "model-offline",
    });
    expect(loginWithAipro).not.toHaveBeenCalled();
    expect(fetchAiproModels).not.toHaveBeenCalled();
  });

  test("FabriX verifies tool support before saving settings", async () => {
    vi.stubEnv("OPENWIKI_PROVIDER", "fabrix");
    vi.stubEnv("FABRIX_API_TOKEN", "synthetic-token");
    vi.stubEnv("FABRIX_CLIENT_KEY", "synthetic-client");
    vi.stubEnv("FABRIX_BASE_URL", "https://fabrix.example.test");
    const ui = mount();
    await waitForText(ui.lastFrame, "model ID");
    ui.stdin.write("enterprise-model");
    await new Promise((resolve) => setTimeout(resolve, 20));
    ui.stdin.write("\r");
    await vi.waitFor(() => expect(testFabrixConnection).toHaveBeenCalled());
    await vi.waitFor(() => expect(saveOpenWikiEnv).toHaveBeenCalled());
    expect(vi.mocked(testFabrixConnection).mock.calls[0][0]).toMatchObject({
      modelId: "enterprise-model",
      token: "synthetic-token",
      clientKey: "synthetic-client",
    });
    expect(stripAnsi(ui.lastFrame())).not.toContain("synthetic-token");
  });

  test("failed FabriX verification leaves settings unsaved", async () => {
    vi.stubEnv("OPENWIKI_PROVIDER", "fabrix");
    vi.stubEnv("FABRIX_API_TOKEN", "synthetic-token");
    vi.stubEnv("FABRIX_CLIENT_KEY", "synthetic-client");
    vi.stubEnv("FABRIX_BASE_URL", "https://fabrix.example.test");
    vi.mocked(testFabrixConnection).mockRejectedValue(
      new FabrixToolProtocolError("request_id_mismatch"),
    );
    const ui = mount();
    await waitForText(ui.lastFrame, "model ID");
    ui.stdin.write("enterprise-model");
    await new Promise((resolve) => setTimeout(resolve, 20));
    ui.stdin.write("\r");
    await waitForText(ui.lastFrame, "연결 테스트에 실패");
    expect(stripAnsi(ui.lastFrame())).toContain("request_id_mismatch");
    expect(saveOpenWikiEnv).not.toHaveBeenCalled();
  });
});
