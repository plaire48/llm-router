import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, opendir, realpath, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { OpenWikiIgnore } from "../agent/openwiki-ignore.js";
import type { WikiGraph } from "./graph.js";
import { retrieveWikiEvidence, type WikiDocument } from "./retrieval.js";

const PREFIX = "/api/nubi/v1/";
const MAX_FILE_BYTES = 512 * 1024;
const MAX_CHARS = 16_000;
const MAX_LINES = 200;
const CODE_TTL = 5 * 60_000;
const SESSION_TTL = 8 * 60 * 60_000;
const MAX_CODES = 32;
const MAX_SESSIONS = 16;
const OMIT_DIRS = new Set([
  "node_modules",
  "vendor",
  "dist",
  "build",
  "coverage",
  "target",
  "__pycache__",
  "venv",
]);
const TEXT_EXT = new Set(
  "ts tsx js jsx mjs cjs json html htm css scss sass less vue svelte md mdx txt py java kt kts c cc cpp h hpp cs go rs rb php sh bash zsh sql yaml yml toml xml svg graphql gql proto r swift dart ex exs erl clj cljs ini cfg conf properties gradle make cmake dockerfile lock".split(
    " ",
  ),
);
const SECRET =
  /(?:^|[._-])(?:secrets?|credentials?|passwords?|private[-_]?keys?|tokens?)(?:[._-]|$)|^id_(?:rsa|dsa|ecdsa|ed25519)$|\.(?:pem|key|p12|pfx|keystore|jks|db|sqlite|sqlite3)$/iu;

class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
function error(status: number, code: string, message: string): never {
  throw new ApiError(status, code, message);
}
const digest = (value: string): string =>
  createHash("sha256").update(value).digest("hex");
function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(JSON.stringify(data));
}
function within(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}
function checkedPath(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 1000 ||
    /[\\:]/u.test(value) ||
    [...value].some((character) => character.charCodeAt(0) < 32) ||
    path.posix.isAbsolute(value) ||
    value.split("/").some((p) => !p || p === "." || p === "..")
  )
    error(400, "invalid_path", "Use a relative file path.");
  return value;
}
function restricted(relative: string): boolean {
  return relative
    .split("/")
    .some(
      (part) =>
        part.startsWith(".") ||
        OMIT_DIRS.has(part.toLowerCase()) ||
        SECRET.test(part),
    );
}
function allowedText(relative: string): boolean {
  const basename = path.posix.basename(relative).toLowerCase();
  return (
    TEXT_EXT.has(path.posix.extname(basename).slice(1)) ||
    ["dockerfile", "makefile", "license", "readme"].includes(basename)
  );
}

/** The source root is explicit and fixed at server startup; requests cannot select it. */
class ReadScope {
  constructor(readonly root: string) {}
  async ignored(relative: string): Promise<boolean> {
    // Honor the closest repository exclusions at every ancestor. Hard exclusions
    // remain non-overridable. Rules are reloaded so edits apply immediately.
    const segments = relative.split("/");
    for (let i = 0; i < segments.length; i += 1) {
      const base = path.join(this.root, ...segments.slice(0, i));
      for (const name of [".gitignore", ".openwikiignore"]) {
        try {
          const candidate = path.join(base, name);
          const actual = await realpath(candidate);
          if (
            !within(this.root, actual) ||
            (await lstat(candidate)).isSymbolicLink()
          )
            error(
              403,
              "excluded_path",
              "The project exclusion file cannot be read safely.",
            );
          const handle = await open(
            candidate,
            constants.O_RDONLY | constants.O_NOFOLLOW,
          );
          try {
            const info = await handle.stat();
            if (!info.isFile() || info.size > 32_768)
              error(
                403,
                "excluded_path",
                "The project's exclusion file cannot be read safely.",
              );
            const buffer = Buffer.alloc(32_769);
            const { bytesRead } = await handle.read(
              buffer,
              0,
              buffer.length,
              0,
            );
            if (bytesRead > 32_768)
              error(
                403,
                "excluded_path",
                "The project exclusion file is too large.",
              );
            const rules = OpenWikiIgnore.parse(
              buffer.subarray(0, bytesRead).toString("utf8"),
            );
            if (rules.ignores(segments.slice(i).join("/"))) return true;
          } finally {
            await handle.close();
          }
        } catch (cause) {
          if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
        }
      }
    }
    return false;
  }
  async read(
    relativeValue: unknown,
    maxBytes = MAX_FILE_BYTES,
  ): Promise<string> {
    const relative = checkedPath(relativeValue);
    if (
      restricted(relative) ||
      !allowedText(relative) ||
      (await this.ignored(relative))
    )
      error(
        403,
        "excluded_path",
        "This file is excluded from project reading.",
      );
    const candidate = path.join(this.root, relative);
    try {
      const actual = await realpath(candidate);
      if (!within(this.root, actual))
        error(
          403,
          "outside_project",
          "The file is outside the connected project.",
        );
      const canonicalRelative = path
        .relative(this.root, actual)
        .split(path.sep)
        .join("/");
      if (
        restricted(canonicalRelative) ||
        !allowedText(canonicalRelative) ||
        (await this.ignored(canonicalRelative))
      )
        error(
          403,
          "excluded_path",
          "This file is excluded from project reading.",
        );
      // Reject symlink components, including links within the project, to keep the
      // read/search policy identical and prevent aliases to excluded directories.
      const parts = relative.split("/");
      for (let i = 1; i <= parts.length; i += 1) {
        if (
          (
            await lstat(path.join(this.root, ...parts.slice(0, i)))
          ).isSymbolicLink()
        )
          error(403, "symlink_path", "Symbolic links are not exposed.");
      }
      const handle = await open(
        candidate,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      try {
        const info = await handle.stat();
        if (!info.isFile()) error(400, "not_file", "Choose a text file.");
        if (info.size > maxBytes)
          error(413, "file_too_large", "This file is too large to read.");
        // Bounded read protects against a file growing after stat.
        const bytes = Buffer.alloc(maxBytes + 1);
        let bytesRead = 0;
        while (bytesRead < bytes.length) {
          const read = await handle.read(
            bytes,
            bytesRead,
            bytes.length - bytesRead,
            bytesRead,
          );
          if (!read.bytesRead) break;
          bytesRead += read.bytesRead;
        }
        if (bytesRead > maxBytes)
          error(413, "file_too_large", "This file is too large to read.");
        const after = await realpath(candidate);
        const current = await stat(after);
        if (
          !within(this.root, after) ||
          current.ino !== info.ino ||
          current.dev !== info.dev
        )
          error(
            409,
            "file_changed",
            "The file changed while reading. Read it again.",
          );
        const buffer = bytes.subarray(0, bytesRead);
        if (buffer.includes(0))
          error(415, "binary_file", "Only text files can be read.");
        try {
          return new TextDecoder("utf-8", {
            fatal: true,
            ignoreBOM: true,
          }).decode(buffer);
        } catch {
          return error(
            415,
            "binary_file",
            "Only UTF-8 text files can be read.",
          );
        }
      } finally {
        await handle.close();
      }
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT")
        error(404, "file_not_found", "The file no longer exists.");
      if (cause instanceof ApiError) throw cause;
      error(403, "file_unavailable", "The file cannot be read.");
    }
  }
  async *files(): AsyncGenerator<string> {
    const queue = [""];
    let count = 0;
    while (queue.length) {
      const directory = queue.shift()!;
      // Never descend into symlinks, including paths changed since enumeration.
      if (
        directory &&
        ((await lstat(path.join(this.root, directory))).isSymbolicLink() ||
          !within(this.root, await realpath(path.join(this.root, directory))))
      )
        continue;
      const dir = await opendir(path.join(this.root, directory));
      for await (const entry of dir) {
        count += 1;
        if (count > 5000)
          throw new ApiError(
            429,
            "search_limit",
            "Search was limited to keep OpenWiki responsive.",
          );
        const relative = directory ? `${directory}/${entry.name}` : entry.name;
        if (restricted(relative) || entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          if (relative.split("/").length <= 12) queue.push(relative);
        } else if (entry.isFile() && allowedText(relative)) yield relative;
      }
    }
  }
}

function numberParam(value: unknown, fallback: number, max: number): number {
  if (value === undefined || value === null) return fallback;
  const n =
    typeof value === "number" || typeof value === "string"
      ? Number(value)
      : NaN;
  if (!Number.isInteger(n) || n < 1 || n > max)
    error(400, "invalid_range", "Use a valid positive range.");
  return n;
}
function excerpt(
  raw: string,
  kind: "wiki" | "source",
  relative: string,
  startValue?: unknown,
  endValue?: unknown,
) {
  const lines = raw.split(/\r?\n/u);
  if (lines.at(-1) === "" && lines.length > 1) lines.pop();
  const start = numberParam(startValue, 1, Math.max(lines.length, 1));
  const requestedEnd = numberParam(
    endValue,
    Math.min(lines.length, start + MAX_LINES - 1),
    Number.MAX_SAFE_INTEGER,
  );
  if (requestedEnd < start || requestedEnd - start >= MAX_LINES)
    error(400, "invalid_range", "Read at most 200 lines at a time.");
  const end = Math.min(lines.length, requestedEnd);
  const selected: string[] = [];
  let chars = 0;
  for (let i = start - 1; i < end; i += 1) {
    if (chars + lines[i].length + (selected.length ? 1 : 0) > MAX_CHARS) {
      if (!selected.length)
        error(413, "line_too_long", "This line exceeds the text limit.");
      break;
    }
    selected.push(lines[i]);
    chars += lines[i].length + 1;
  }
  const actualEnd = start + selected.length - 1;
  return {
    content: selected.join("\n"),
    provenance: {
      kind,
      path: relative,
      hash: digest(raw),
      start,
      end: actualEnd,
      totalLines: lines.length,
    },
    truncated: actualEnd < lines.length,
    ...(actualEnd < lines.length ? { nextStart: actualEnd + 1 } : {}),
  };
}
async function readJson(
  req: IncomingMessage,
): Promise<Record<string, unknown>> {
  if (
    !/^application\/json(?:\s*;|$)/iu.test(
      String(req.headers["content-type"] ?? ""),
    )
  )
    error(415, "json_required", "Send a JSON request.");
  if (Number(req.headers["content-length"] ?? 0) > 8192)
    error(413, "body_too_large", "The request is too large.");
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    const finish = (cause?: Error, value?: Record<string, unknown>) => {
      clearTimeout(timer);
      req.off("data", data);
      req.off("end", end);
      req.off("error", failed);
      req.off("aborted", aborted);
      if (cause) {
        req.once("error", () => {});
        req.resume();
        reject(cause);
      } else resolve(value!);
    };
    const data = (chunk: Buffer) => {
      size += chunk.length;
      if (size > 8192)
        finish(
          new ApiError(413, "body_too_large", "The request is too large."),
        );
      else chunks.push(chunk);
    };
    const end = () => {
      try {
        const value: unknown = JSON.parse(
          Buffer.concat(chunks).toString("utf8"),
        );
        if (!value || typeof value !== "object" || Array.isArray(value))
          throw new Error();
        finish(undefined, value as Record<string, unknown>);
      } catch {
        finish(new ApiError(400, "invalid_json", "Send a JSON object."));
      }
    };
    const failed = () =>
      finish(
        new ApiError(
          400,
          "request_interrupted",
          "The request was interrupted.",
        ),
      );
    const aborted = () => failed();
    const timer = setTimeout(
      () =>
        finish(new ApiError(408, "request_timeout", "The request timed out.")),
      5000,
    );
    req.on("data", data);
    req.once("end", end);
    req.once("error", failed);
    req.once("aborted", aborted);
  });
}

export interface NubiOptions {
  wikiRoot: string;
  projectRoot?: string;
  getGraph: () => WikiGraph;
  now?: () => number;
}
export interface NubiApi {
  guard(req: IncomingMessage, res: ServerResponse): boolean;
  decorateHtml(html: string): string;
  handle(req: IncomingMessage, res: ServerResponse): Promise<void>;
}

/** A read-only, process-scoped API paired from the currently open visualizer. */
export async function createNubiApi(options: NubiOptions): Promise<NubiApi> {
  const wiki = new ReadScope(await realpath(options.wikiRoot));
  const source = options.projectRoot
    ? new ReadScope(await realpath(options.projectRoot))
    : undefined;
  if (
    !(await stat(wiki.root)).isDirectory() ||
    (source && !(await stat(source.root)).isDirectory())
  )
    throw new Error("Wiki and project roots must be directories.");
  const now = options.now ?? Date.now;
  const project = {
    id: randomBytes(18).toString("base64url"),
    name: path.basename(source?.root ?? wiki.root),
  };
  const capabilities = source ? ["wiki", "source"] : ["wiki"];
  const codes = new Map<string, number>();
  const sessions = new Map<string, number>();
  let active = 0;
  const prune = () => {
    for (const collection of [codes, sessions])
      for (const [key, expiry] of collection)
        if (expiry <= now()) collection.delete(key);
  };
  const guard = (req: IncomingMessage, res: ServerResponse): boolean => {
    const host = String(req.headers.host ?? "");
    const hostMatch = /^(localhost|127\.0\.0\.1|\[::1\]):([0-9]{1,5})$/iu.exec(
      host,
    );
    const expected = req.socket.localPort;
    if (
      !hostMatch ||
      Number(hostMatch[2]) > 65535 ||
      (expected && Number(hostMatch[2]) !== expected)
    ) {
      json(res, 403, {
        error: {
          code: "invalid_host",
          message: "Only the local OpenWiki address is allowed.",
        },
      });
      return false;
    }
    const origin = req.headers.origin;
    const extension =
      typeof origin === "string" &&
      /^chrome-extension:\/\/[a-p]{32}$/u.test(origin);
    const same = origin === `http://${host}`;
    if (
      (origin && !extension && !same) ||
      (!extension && req.headers["sec-fetch-site"] === "cross-site")
    ) {
      json(res, 403, {
        error: {
          code: "invalid_origin",
          message: "This origin cannot access OpenWiki.",
        },
      });
      return false;
    }
    if (extension) {
      res.setHeader("access-control-allow-origin", origin);
      res.setHeader("vary", "Origin");
    }
    return true;
  };
  return {
    guard,
    decorateHtml(html) {
      prune();
      while (codes.size >= MAX_CODES) codes.delete(codes.keys().next().value!);
      const code = randomBytes(32).toString("base64url");
      codes.set(digest(code), now() + CODE_TTL);
      return html.replace(
        "</head>",
        `<meta name="nubi-pairing-code" content="${code}">\n</head>`,
      );
    },
    async handle(req, res) {
      try {
        if (!guard(req, res)) return;
        const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
        const route = url.pathname.slice(PREFIX.length);
        if (req.method === "OPTIONS") {
          res.writeHead(204, {
            "access-control-allow-methods": "GET, POST, OPTIONS",
            "access-control-allow-headers": "authorization, content-type",
            "access-control-max-age": "600",
            "cache-control": "no-store",
          });
          res.end();
          return;
        }
        prune();
        if (route === "info" && req.method === "GET") {
          json(res, 200, {
            protocol: 1,
            service: "openwiki",
            capabilities,
            features: ["wiki_query", "wiki_snapshot"],
          });
          return;
        }
        if (active >= 4)
          error(429, "busy", "OpenWiki is busy. Try again shortly.");
        active += 1;
        try {
          if (route === "pair" && req.method === "POST") {
            const body = await readJson(req);
            if (typeof body.code !== "string" || body.code.length > 128)
              error(
                401,
                "pairing_expired",
                "Open the OpenWiki page again to connect.",
              );
            const expiry = codes.get(digest(body.code));
            codes.delete(digest(body.code));
            if (!expiry || expiry <= now())
              error(
                401,
                "pairing_expired",
                "Open the OpenWiki page again to connect.",
              );
            if (sessions.size >= MAX_SESSIONS)
              error(429, "session_limit", "Too many active connections.");
            const token = randomBytes(32).toString("base64url");
            const expires = now() + SESSION_TTL;
            sessions.set(digest(token), expires);
            json(res, 200, {
              protocol: 1,
              token,
              expiresAt: new Date(expires).toISOString(),
              project,
              capabilities,
              features: ["wiki_query", "wiki_snapshot"],
            });
            return;
          }
          const auth = /^Bearer ([A-Za-z0-9_-]{43})$/u.exec(
            String(req.headers.authorization ?? ""),
          );
          if (!auth || !sessions.has(digest(auth[1])))
            error(401, "connection_expired", "Reconnect OpenWiki to continue.");
          if (route === "disconnect" && req.method === "POST") {
            sessions.delete(digest(auth[1]));
            json(res, 200, { ok: true });
            return;
          }
          if (route === "wiki/snapshot" && req.method === "GET") {
            const documents = [];
            let characters = 0,
              sourceComplete = true;
            for (const node of options.getGraph().nodes) {
              if (documents.length >= 300) {
                sourceComplete = false;
                break;
              }
              try {
                const relative = `${checkedPath(node.id)}.md`;
                const text = await wiki.read(relative, 16 * 1024 * 1024);
                if (
                  text.length > 4_000_000 ||
                  characters + text.length > 8_000_000
                ) {
                  sourceComplete = false;
                  continue;
                }
                characters += text.length;
                documents.push({
                  id: node.id,
                  title: node.title,
                  path: relative,
                  kind: "wiki",
                  text,
                });
              } catch {
                sourceComplete = false;
              }
            }
            json(res, 200, {
              projectId: project.id,
              documents,
              sourceComplete,
            });
            return;
          }
          if (route === "wiki/query" && req.method === "POST") {
            const body = await readJson(req);
            if (
              typeof body.question !== "string" ||
              !body.question.trim() ||
              body.question.length > 1000 ||
              Object.keys(body).some(
                (key) => !["question", "limit"].includes(key),
              )
            )
              error(
                400,
                "invalid_query",
                "Ask a question of 1 to 1000 characters.",
              );
            const limit = numberParam(body.limit, 5, 5);
            const graph = options.getGraph(),
              documents: WikiDocument[] = [];
            let bytes = 0,
              truncated = false;
            const until = performance.now() + 2500;
            for (const node of graph.nodes) {
              if (
                documents.length >= 300 ||
                bytes >= 4 * 1024 * 1024 ||
                performance.now() > until
              ) {
                truncated = true;
                break;
              }
              try {
                const raw = await wiki.read(`${checkedPath(node.id)}.md`);
                bytes += Buffer.byteLength(raw);
                if (bytes > 4 * 1024 * 1024) {
                  truncated = true;
                  break;
                }
                documents.push({ id: node.id, title: node.title, raw });
              } catch (cause) {
                if (!(cause instanceof ApiError)) throw cause;
                truncated = true;
              }
            }
            const packet = retrieveWikiEvidence(
              documents,
              body.question,
              limit,
            );
            json(res, 200, {
              projectId: project.id,
              ...packet,
              results: packet.results.map((row) => ({
                ...row,
                graphGeneratedAt: graph.generatedAt,
              })),
              truncated: truncated || packet.truncated,
              coverage: {
                scannedDocuments: documents.length,
                indexedDocuments: graph.nodes.length,
                complete: !truncated && !packet.retrieval.incomplete,
              },
              instruction:
                "Evidence excerpts, not a generated answer or verified source-to-screen mapping. Read missing context only when needed; an empty or partial result does not prove absence.",
            });
            return;
          }
          if (route === "wiki/page" && req.method === "GET") {
            const id = checkedPath(url.searchParams.get("id"));
            const node = options.getGraph().nodes.find((n) => n.id === id);
            if (!node)
              error(404, "page_not_found", "The wiki page no longer exists.");
            const relative = `${id}.md`;
            const value = excerpt(
              await wiki.read(relative),
              "wiki",
              relative,
              url.searchParams.get("start"),
              url.searchParams.get("end"),
            );
            json(res, 200, {
              projectId: project.id,
              id,
              title: node.title,
              ...value,
              graphGeneratedAt: options.getGraph().generatedAt,
            });
            return;
          }
          if (route === "source" && req.method === "GET") {
            if (!source)
              error(
                409,
                "source_unavailable",
                "This connection contains wiki documents only.",
              );
            const relative = checkedPath(url.searchParams.get("path"));
            json(res, 200, {
              projectId: project.id,
              path: relative,
              ...excerpt(
                await source.read(relative),
                "source",
                relative,
                url.searchParams.get("start"),
                url.searchParams.get("end"),
              ),
            });
            return;
          }
          if (
            (route === "wiki/search" || route === "source/search") &&
            req.method === "POST"
          ) {
            const body = await readJson(req);
            if (
              typeof body.query !== "string" ||
              !body.query.trim() ||
              body.query.length > 300
            )
              error(
                400,
                "invalid_query",
                "Enter a search term of 1 to 300 characters.",
              );
            const query = body.query.trim().toLocaleLowerCase();
            const limit = numberParam(body.limit, 5, 10);
            const results: unknown[] = [];
            const graph = options.getGraph();
            let bytes = 0;
            let scanned = 0;
            let truncated = false;
            const until = performance.now() + 2500;
            const kind = route.startsWith("wiki") ? "wiki" : "source";
            const scope = kind === "wiki" ? wiki : source;
            if (!scope)
              error(
                409,
                "source_unavailable",
                "This connection contains wiki documents only.",
              );
            const nodes = new Map(
              graph.nodes.map((node) => [`${node.id}.md`, node]),
            );
            const candidates = kind === "wiki" ? nodes.keys() : scope.files();
            try {
              for await (const relative of candidates) {
                if (
                  results.length >= limit ||
                  scanned >= 1000 ||
                  bytes >= 8 * 1024 * 1024 ||
                  performance.now() > until
                ) {
                  truncated = true;
                  break;
                }
                scanned += 1;
                try {
                  const raw = await scope.read(relative);
                  bytes += Buffer.byteLength(raw);
                  const node = nodes.get(relative);
                  const lines = raw.split(/\r?\n/u);
                  const line = lines.findIndex((text) =>
                    text.toLocaleLowerCase().includes(query),
                  );
                  if (
                    line < 0 &&
                    !(
                      kind === "wiki"
                        ? `${relative} ${node?.title ?? ""}`
                        : relative
                    )
                      .toLocaleLowerCase()
                      .includes(query)
                  )
                    continue;
                  const start = Math.max(1, line + 1 - 2);
                  const end = Math.min(
                    lines.at(-1) === "" && lines.length > 1
                      ? lines.length - 1
                      : lines.length,
                    start + 6,
                  );
                  const value = excerpt(raw, kind, relative, start, end);
                  results.push({
                    ...(kind === "wiki"
                      ? {
                          id: node!.id,
                          title: node!.title,
                          graphGeneratedAt: graph.generatedAt,
                        }
                      : { path: relative }),
                    excerpt: value.content,
                    provenance: value.provenance,
                  });
                } catch (cause) {
                  if (!(cause instanceof ApiError)) throw cause;
                }
              }
            } catch (cause) {
              if (cause instanceof ApiError && cause.code === "search_limit")
                truncated = true;
              else throw cause;
            }
            json(res, 200, { projectId: project.id, results, truncated });
            return;
          }
          error(404, "not_found", "This API route does not exist.");
        } finally {
          active -= 1;
        }
      } catch (cause) {
        if (res.destroyed || res.writableEnded) return;
        const failure =
          cause instanceof ApiError
            ? cause
            : new ApiError(
                500,
                "read_failed",
                "OpenWiki could not complete this read.",
              );
        json(res, failure.status, {
          error: { code: failure.code, message: failure.message },
        });
      }
    },
  };
}
