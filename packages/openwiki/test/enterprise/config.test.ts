import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import {
  getMissingProviderEnvKey,
  isValidProviderModelId,
  providerUsesOAuth,
  resolveConfiguredProvider,
} from "../../src/config/constants.js";
import { formatEnvironmentDebugValue } from "../../src/agent/index.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});
test.each(["fabrix", "aipro-cli"] as const)(
  "stores and reloads %s credentials in OpenWiki's protected env file",
  async (provider) => {
    const dir = await mkdtemp(path.join(tmpdir(), "openwiki-enterprise-env-"));
    vi.stubEnv("OPENWIKI_CONFIG_DIR", dir);
    for (const key of [
      "OPENWIKI_PROVIDER",
      "OPENWIKI_MODEL_ID",
      "AIPRO_ACCESS_TOKEN",
      "AIPRO_CLI_TOKEN",
      "AIPRO_CLI_BASE_URL",
      "FABRIX_API_TOKEN",
      "FABRIX_CLIENT_KEY",
      "FABRIX_BASE_URL",
    ])
      vi.stubEnv(key, undefined);
    vi.resetModules();
    try {
      const env = await import("../../src/config/env.js");
      const values: Record<string, string> = {
        OPENWIKI_PROVIDER: provider,
        OPENWIKI_MODEL_ID: "test-model",
        FABRIX_API_TOKEN: "sensitive-token-value",
        FABRIX_CLIENT_KEY: "sensitive-client-value",
        FABRIX_BASE_URL: "https://fabrix.example.test",
        AIPRO_ACCESS_TOKEN: "synthetic-only",
        AIPRO_CLI_TOKEN: "synthetic-cli-token",
        AIPRO_CLI_BASE_URL: "https://cli.example.test/v1",
      };
      await env.saveOpenWikiEnv(values);
      expect(await readFile(path.join(dir, ".env"), "utf8")).toContain(
        "FABRIX_CLIENT_KEY=",
      );
      if (process.platform !== "win32")
        expect((await stat(path.join(dir, ".env"))).mode & 0o777).toBe(0o600);
      for (const key of Object.keys(values)) delete process.env[key];
      await env.loadOpenWikiEnv();
      expect(process.env.FABRIX_API_TOKEN).toBe(values.FABRIX_API_TOKEN);
      expect(resolveConfiguredProvider()).toBe(provider);
      expect(process.env.AIPRO_CLI_BASE_URL).toBe(values.AIPRO_CLI_BASE_URL);
      expect(process.env.AIPRO_CLI_TOKEN).toBe(values.AIPRO_CLI_TOKEN);
      for (const key of [
        "FABRIX_API_TOKEN",
        "FABRIX_CLIENT_KEY",
        "AIPRO_ACCESS_TOKEN",
        "AIPRO_CLI_TOKEN",
      ]) {
        expect(formatEnvironmentDebugValue(key, values[key])).not.toContain(
          "preview",
        );
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);
test("native ChatGPT OAuth remains separate and FabriX requires both keys and endpoint", () => {
  expect(providerUsesOAuth("openai-chatgpt")).toBe(true);
  expect(providerUsesOAuth("aipro")).toBe(false);
  expect(providerUsesOAuth("aipro-cli")).toBe(false);
  expect(getMissingProviderEnvKey("fabrix", { FABRIX_API_TOKEN: "x" })).toBe(
    "FABRIX_CLIENT_KEY",
  );
  expect(
    getMissingProviderEnvKey("fabrix", {
      FABRIX_API_TOKEN: "x",
      FABRIX_CLIENT_KEY: "y",
    }),
  ).toBe("FABRIX_BASE_URL");
});

test("enterprise model IDs remain opaque while standard provider validation is unchanged", () => {
  expect(
    isValidProviderModelId("aipro", "company model (" + "a".repeat(140) + ")"),
  ).toBe(true);
  expect(isValidProviderModelId("fabrix", "model-id")).toBe(true);
  expect(isValidProviderModelId("aipro-cli", "company model (v1)")).toBe(true);
  expect(isValidProviderModelId("aipro-cli", "bad\nmodel")).toBe(false);
  expect(isValidProviderModelId("aipro", "bad\nmodel")).toBe(false);
  expect(isValidProviderModelId("openai", "company model (v1)")).toBe(false);
});
