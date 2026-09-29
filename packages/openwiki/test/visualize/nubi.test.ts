import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, test } from "vitest";
import { createNubiApi } from "../../src/visualize/nubi.ts";
import { buildGraph } from "../../src/visualize/graph.ts";
import { createRequestHandler } from "../../src/visualize/server.ts";

interface TestApiData {
  sourceComplete: boolean;
  documents: Array<{ id: string; kind: string; path: string; text: string }>;
  token: string;
  project: { id: string; name: string };
  projectId: string;
  capabilities: string[];
  content: string;
  provenance: {
    path: string;
    hash: string;
    start: number;
    end: number;
    totalLines: number;
    kind: string;
  };
  results: Array<{
    id: string;
    title: string;
    path: string;
    excerpt: string;
    provenance: TestApiData["provenance"];
  }>;
  graphGeneratedAt: string;
  truncated: boolean;
  nextStart?: number;
}
type TestResponse = Omit<Response, "json"> & {
  json: () => Promise<TestApiData>;
};

test("library queries use paired project scope, fresh text and grounded line excerpts", async () => {
  const f = await fixture();
  expect(
    (await f.post("wiki/query", { question: "How does saveDraft work?" }))
      .status,
  ).toBe(401);
  const { token } = await f.pair();
  const result = await f.post(
    "wiki/query",
    { question: "How does saveDraft save the draft?" },
    token,
  );
  expect(result.status).toBe(200);
  const data = await result.json();
  expect(data.results.some((row) => row.excerpt.includes("saveDraft"))).toBe(
    true,
  );
  expect(data.results[0].provenance.path).toBe("save.md");
  const hash = data.results[0].provenance.hash;
  await writeFile(
    path.join(f.wikiRoot, "save.md"),
    "# Save button\nUpdated saveDraft documentation.\n",
  );
  const updated = await (
    await f.post("wiki/query", { question: "saveDraft documentation" }, token)
  ).json();
  expect(updated.results[0].provenance.hash).not.toBe(hash);
  expect(updated.results[0].excerpt).toContain("Updated");
  expect(
    (await f.post("wiki/query", { question: "save", projectRoot: "/" }, token))
      .status,
  ).toBe(400);
  await writeFile(path.join(f.wikiRoot, ".openwikiignore"), "save.md\n");
  const excluded = await (
    await f.post("wiki/query", { question: "saveDraft" }, token)
  ).json();
  expect(excluded.results).toEqual([]);
  expect(excluded.truncated).toBe(true);
});

test("agent snapshots require pairing and retain long fresh Wiki text within the read scope", async () => {
  const f = await fixture();
  expect((await f.call("wiki/snapshot")).status).toBe(401);
  const { token } = await f.pair();
  const text = "x".repeat(600000) + "TAIL";
  await writeFile(path.join(f.wikiRoot, "save.md"), text);
  const first = await (await f.read("wiki/snapshot", token)).json();
  expect(first.sourceComplete).toBe(true);
  expect(first.documents).toEqual([
    { id: "save", title: "Save button", kind: "wiki", path: "save.md", text },
  ]);
  await writeFile(path.join(f.wikiRoot, "save.md"), "changed");
  expect(
    (await (await f.read("wiki/snapshot", token)).json()).documents[0].text,
  ).toBe("changed");
  await writeFile(path.join(f.wikiRoot, ".openwikiignore"), "save.md\n");
  const ignored = await (await f.read("wiki/snapshot", token)).json();
  expect(ignored.documents).toEqual([]);
  expect(ignored.sourceComplete).toBe(false);
  expect((await f.post("wiki/snapshot", {}, token)).status).toBe(404);
});

const roots: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture(source = true) {
  const root = await mkdtemp(path.join(tmpdir(), "openwiki-nubi-"));
  roots.push(root);
  const wikiRoot = path.join(root, "wiki");
  const projectRoot = path.join(root, "project");
  await mkdir(wikiRoot);
  await mkdir(projectRoot);
  await mkdir(path.join(projectRoot, "src"));
  await writeFile(
    path.join(wikiRoot, "save.md"),
    "---\ntitle: Save button\n---\n# Save\nThe save button calls saveDraft in src/save.ts.\n",
  );
  await writeFile(
    path.join(projectRoot, "src/save.ts"),
    "export function saveDraft() {\n  return 'draft';\n}\n",
  );
  let clock = Date.now();
  let graph = await buildGraph(wikiRoot);
  const nubi = await createNubiApi({
    wikiRoot,
    ...(source ? { projectRoot } : {}),
    getGraph: () => graph,
    now: () => clock,
  });
  const server = createServer(
    createRequestHandler({
      getGraph: () => graph,
      nubi,
      clientJs: "",
      clientLibJs: "",
      stylesCss: "",
      sseClients: new Set(),
    }),
  );
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (
    route: string,
    options: RequestInit = {},
  ): Promise<TestResponse> =>
    await fetch(`${base}/api/nubi/v1/${route}`, options);
  const code = async () =>
    (await (await fetch(base)).text()).match(
      /name="nubi-pairing-code" content="([^"]+)"/,
    )![1];
  const post = (route: string, body: unknown, token?: string) =>
    call(route, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  const pair = async () => (await post("pair", { code: await code() })).json();
  const read = (route: string, token: string) =>
    call(route, { headers: { authorization: `Bearer ${token}` } });
  return {
    root,
    wikiRoot,
    projectRoot,
    base,
    call,
    post,
    read,
    pair,
    code,
    advance: (ms: number) => {
      clock += ms;
    },
    rebuild: async () => {
      graph = await buildGraph(wikiRoot);
    },
  };
}

describe("OpenWiki Nubi read-only HTTP API", () => {
  test("pairs once, reads current source and wiki evidence, and revokes the session", async () => {
    const f = await fixture();
    const info = await (await f.call("info")).json();
    expect(info).toEqual({
      protocol: 1,
      service: "openwiki",
      features: ["wiki_query", "wiki_snapshot"],
      capabilities: ["wiki", "source"],
    });
    expect(JSON.stringify(info)).not.toContain(f.root);
    expect((await f.call("source?path=src/save.ts")).status).toBe(401);
    const code = await f.code();
    const pair = await (await f.post("pair", { code })).json();
    expect(pair.project.name).toBe("project");
    expect((await f.post("pair", { code })).status).toBe(401);
    const data = await (
      await f.read("source?path=src/save.ts&start=1&end=2", pair.token)
    ).json();
    expect(data.projectId).toBe(pair.project.id);
    expect(data.content).toContain("saveDraft");
    expect(data.provenance).toMatchObject({
      path: "src/save.ts",
      start: 1,
      end: 2,
      totalLines: 3,
    });
    expect(data.provenance.hash).toMatch(/^[a-f0-9]{64}$/);
    const clamped = await (
      await f.read("source?path=src/save.ts&start=1&end=200", pair.token)
    ).json();
    expect(clamped.provenance).toMatchObject({
      start: 1,
      end: 3,
      totalLines: 3,
    });
    expect(clamped.truncated).toBe(false);
    await writeFile(
      path.join(f.projectRoot, "src/save.ts"),
      "export function saveDraft() { return 'updated'; }\n",
    );
    const changed = await (
      await f.read("source?path=src/save.ts", pair.token)
    ).json();
    expect(changed.content).toContain("updated");
    expect(changed.provenance.hash).not.toBe(data.provenance.hash);
    const wiki = await (
      await f.post("wiki/search", { query: "saveDraft" }, pair.token)
    ).json();
    expect(wiki.results[0]).toMatchObject({
      id: "save",
      title: "Save button",
      provenance: { kind: "wiki", path: "save.md", start: 3, end: 5 },
    });
    const page = await (await f.read("wiki/page?id=save", pair.token)).json();
    expect(page.content).toContain("src/save.ts");
    expect(page.graphGeneratedAt).toBeTruthy();
    expect(JSON.stringify(page)).not.toContain(f.root);
    const matches = await (
      await f.post("source/search", { query: "saveDraft" }, pair.token)
    ).json();
    expect(matches.results[0].path).toBe("src/save.ts");
    expect((await f.post("disconnect", {}, pair.token)).status).toBe(200);
    expect((await f.read("source?path=src/save.ts", pair.token)).status).toBe(
      401,
    );
  });

  test("expires pairing codes and tokens without persisting either", async () => {
    const f = await fixture();
    const code = await f.code();
    f.advance(5 * 60_000);
    expect((await f.post("pair", { code })).status).toBe(401);
    const { token } = await f.pair();
    f.advance(8 * 60 * 60_000);
    expect((await f.read("wiki/page?id=save", token)).status).toBe(401);
  });

  test("wiki-only connections never infer or expose a project root", async () => {
    const f = await fixture(false);
    const pair = await f.pair();
    expect(pair.capabilities).toEqual(["wiki"]);
    expect((await f.read("wiki/page?id=save", pair.token)).status).toBe(200);
    expect((await f.read("source?path=src/save.ts", pair.token)).status).toBe(
      409,
    );
    expect(
      (await f.post("source/search", { query: "save" }, pair.token)).status,
    ).toBe(409);
  });

  test("rejects traversal, symlinks, excluded secrets, binary and large files", async () => {
    const f = await fixture();
    const { token } = await f.pair();
    await writeFile(path.join(f.root, "outside.ts"), "outside secret");
    await symlink(
      path.join(f.root, "outside.ts"),
      path.join(f.projectRoot, "external.ts"),
    );
    await symlink(
      path.join(f.projectRoot, "src/save.ts"),
      path.join(f.projectRoot, "alias.ts"),
    );
    await writeFile(path.join(f.projectRoot, ".env"), "TOKEN=secret");
    await writeFile(
      path.join(f.projectRoot, "credentials.json"),
      '{"password":"secret"}',
    );
    await writeFile(
      path.join(f.projectRoot, "binary.ts"),
      Buffer.from([0, 1, 2]),
    );
    await writeFile(
      path.join(f.projectRoot, "huge.ts"),
      "x".repeat(512 * 1024 + 1),
    );
    for (const [file, status] of [
      ["../outside.ts", 400],
      ["/etc/passwd", 400],
      ["src\\save.ts", 400],
      ["external.ts", 403],
      ["alias.ts", 403],
      [".env", 403],
      ["credentials.json", 403],
      ["binary.ts", 415],
      ["huge.ts", 413],
    ] as const) {
      const response = await f.read(
        `source?path=${encodeURIComponent(file)}`,
        token,
      );
      expect(response.status, file).toBe(status);
      expect(await response.text()).not.toContain(f.root);
    }
    const result = await (
      await f.post("source/search", { query: "secret" }, token)
    ).json();
    expect(result.results).toEqual([]);
  });

  test("reloads root and nested ignore rules and enforces canonical case-insensitive exclusions", async () => {
    const f = await fixture();
    const { token } = await f.pair();
    await writeFile(
      path.join(f.projectRoot, ".openwikiignore"),
      "src/save.ts\n",
    );
    expect((await f.read("source?path=src/save.ts", token)).status).toBe(403);
    expect(
      (
        await (
          await f.post("source/search", { query: "saveDraft" }, token)
        ).json()
      ).results,
    ).toEqual([]);
    await writeFile(path.join(f.projectRoot, ".openwikiignore"), "");
    await writeFile(path.join(f.projectRoot, "src/.gitignore"), "save.ts\n");
    expect((await f.read("source?path=src/save.ts", token)).status).toBe(403);
    await writeFile(path.join(f.projectRoot, "src/.gitignore"), "");
    expect((await f.read("source?path=src/save.ts", token)).status).toBe(200);
  });

  test("rejects hostile web origins and Host rebinding while allowing extension preflight", async () => {
    const f = await fixture();
    for (const route of ["", "/api/graph", "/api/nubi/v1/info"]) {
      const response = await fetch(f.base + route, {
        headers: { origin: "https://evil.example" },
      });
      expect(response.status).toBe(403);
      expect(response.headers.has("access-control-allow-origin")).toBe(false);
    }
    const invalidHost = await new Promise<number>((resolve) => {
      request(
        f.base + "/api/nubi/v1/info",
        { headers: { host: "evil.example:4321" } },
        (response) => {
          response.resume();
          resolve(response.statusCode!);
        },
      ).end();
    });
    expect(invalidHost).toBe(403);
    const origin = `chrome-extension://${"a".repeat(32)}`;
    const preflight = await f.call("pair", {
      method: "OPTIONS",
      headers: { origin, "access-control-request-method": "POST" },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe(origin);
    const unauth = await f.call("wiki/page?id=save", { headers: { origin } });
    expect(unauth.status).toBe(401);
  });

  test("limits body, ranges, search and text chunks without silently clipping lines", async () => {
    const f = await fixture();
    const { token } = await f.pair();
    expect(
      (await f.post("wiki/search", { query: "x".repeat(9000) }, token)).status,
    ).toBe(413);
    expect(
      (await f.post("source/search", { query: "save", limit: 11 }, token))
        .status,
    ).toBe(400);
    expect(
      (await f.read("source?path=src/save.ts&start=2&end=1", token)).status,
    ).toBe(400);
    await writeFile(
      path.join(f.projectRoot, "many.ts"),
      Array.from({ length: 500 }, (_, i) => `line ${i + 1}`).join("\n"),
    );
    const chunk = await (await f.read("source?path=many.ts", token)).json();
    expect(chunk.provenance).toMatchObject({
      start: 1,
      end: 200,
      totalLines: 500,
    });
    expect(chunk.nextStart).toBe(201);
    expect(
      (await f.read("source?path=many.ts&start=1&end=201", token)).status,
    ).toBe(400);
    await writeFile(
      path.join(f.projectRoot, "wide.ts"),
      Array.from({ length: 100 }, () => "x".repeat(300)).join("\n"),
    );
    const wide = await (await f.read("source?path=wide.ts", token)).json();
    expect(wide.content.length).toBeLessThanOrEqual(16000);
    expect(wide.provenance.end).toBe(53);
    expect(wide.nextStart).toBe(54);
    await writeFile(path.join(f.projectRoot, "line.ts"), "x".repeat(16001));
    expect((await f.read("source?path=line.ts", token)).status).toBe(413);
  });

  test("code slots are bounded, tokens are scoped to one server, and page reloads mint new codes", async () => {
    const f = await fixture();
    const stale = await f.code();
    for (let i = 0; i < 32; i += 1) await f.code();
    expect((await f.post("pair", { code: stale })).status).toBe(401);
    const pair = await f.pair();
    const second = await fixture();
    expect((await second.read("wiki/page?id=save", pair.token)).status).toBe(
      401,
    );
    expect((await second.pair()).project.id).not.toBe(pair.project.id);
    expect(await f.code()).not.toBe(await f.code());
  });
});
