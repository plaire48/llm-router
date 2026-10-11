import MiniSearch from "minisearch";
import { createHash } from "node:crypto";

export interface WikiDocument {
  id: string;
  title: string;
  raw: string;
}
const stop = new Set([
  "the",
  "and",
  "what",
  "how",
  "does",
  "this",
  "from",
  "with",
  "please",
  "어떻게",
  "어디",
  "알려줘",
  "알려주세요",
  "해주세요",
]);
function terms(text: string): string[] {
  return [
    ...new Set(
      (
        text
          .normalize("NFKC")
          .replace(/([a-z\d])([A-Z])/gu, "$1 $2")
          .toLowerCase()
          .match(/[\p{L}\p{N}]+/gu) ?? []
      )
        .map((word) =>
          /^[가-힣]{3,}$/u.test(word)
            ? word.replace(/(?:에서는|에서|으로|은|는|을|를|의|에|와|과)$/u, "")
            : word,
        )
        .filter((word) => !stop.has(word)),
    ),
  ];
}

/** Local retrieval only: structural context + BM25, no provider calls or generated facts. */
export function retrieveWikiEvidence(
  documents: WikiDocument[],
  question: string,
  limit = 5,
) {
  const chunks: Array<{
    id: number;
    doc: WikiDocument;
    title: string;
    context: string;
    text: string;
    start: number;
    end: number;
    totalLines: number;
    hash: string;
  }> = [];
  let omittedChunks = 0;
  for (const doc of documents) {
    const lines = doc.raw.split(/\r?\n/u);
    const hash = createHash("sha256").update(doc.raw).digest("hex");
    let heading = "";
    for (let at = 0; at < lines.length;) {
      const start = at;
      let size = 0;
      while (at < lines.length && at - start < 40) {
        const line = lines[at];
        if (
          at > start &&
          (/^#{1,6}\s/u.test(line) || size + line.length > 2400)
        )
          break;
        if (/^#{1,6}\s/u.test(line)) heading = line.replace(/^#+\s/u, "");
        size += line.length + 1;
        at++;
      }
      const text = lines.slice(start, at).join("\n");
      // A huge single line cannot be represented by truthful line provenance.
      if (text.length > 6000) {
        omittedChunks++;
        continue;
      }
      if (!text.trim()) continue;
      chunks.push({
        id: chunks.length,
        doc,
        title: doc.title,
        context: `${doc.id} ${heading}`,
        text,
        start: start + 1,
        end: at,
        totalLines: lines.length,
        hash,
      });
    }
  }
  const queryTerms = terms(question).slice(0, 32);
  const index = new MiniSearch({
    fields: ["title", "context", "text"],
    tokenize: terms,
  });
  index.addAll(chunks);
  const hits = index.search(queryTerms.join(" "), {
    boost: { title: 3, context: 2 },
    prefix: (term) => term.length >= 3,
    fuzzy: false,
  });
  const perDocument = new Map<string, number>();
  let returnedCharacters = 0;
  const results = [];
  for (const hit of hits) {
    const chunk = chunks[Number(hit.id)];
    if (
      (perDocument.get(chunk.doc.id) ?? 0) >= 2 ||
      returnedCharacters + chunk.text.length > 10000
    )
      continue;
    perDocument.set(chunk.doc.id, (perDocument.get(chunk.doc.id) ?? 0) + 1);
    returnedCharacters += chunk.text.length;
    results.push({
      id: chunk.doc.id,
      title: chunk.doc.title,
      excerpt: chunk.text,
      provenance: {
        kind: "wiki",
        path: `${chunk.doc.id}.md`,
        hash: chunk.hash,
        start: chunk.start,
        end: chunk.end,
        totalLines: chunk.totalLines,
      },
    });
    if (results.length >= limit) break;
  }
  return {
    results,
    retrieval: {
      method: "structural-bm25",
      matchedChunks: hits.length,
      returnedCharacters,
      incomplete: omittedChunks > 0,
    },
    truncated: results.length < hits.length,
  };
}
