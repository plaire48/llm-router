import { describe, expect, test } from "vitest";
import { retrieveWikiEvidence } from "../../src/visualize/retrieval.js";

describe("OpenWiki evidence retrieval", () => {
  const documents = [
    {
      id: "checkout",
      title: "Checkout workflow",
      raw: "# Checkout\nCheckoutButton shows the order review.\n\n## Draft validation\nvalidateDraft checks quantity before payment.\n",
    },
    {
      id: "training",
      title: "교육 안내",
      raw: "# 교육 신청\n담당자는 수강생 이름과 교육 일정을 확인합니다.\n\n## 신청 초안\n제목과 본문을 입력하고 초안을 확인한 후 등록합니다.\n",
    },
    {
      id: "mail",
      title: "Mail composer",
      raw: "# Mail composer\nThe recipient and subject are required before sending.\n",
    },
  ];
  test("questions retrieve grounded sections when whole-question substring search misses", () => {
    const cases = [
      ["How does CheckoutButton show the order review?", "checkout"],
      ["What checks quantity in validateDraft?", "checkout"],
      ["Which Mail composer recipient fields are required?", "mail"],
      ["교육 신청에서 수강생 이름은 어디서 확인하나요?", "training"],
      ["신청 초안에 제목과 본문을 입력하려면?", "training"],
    ];
    let baseline = 0,
      retrieved = 0;
    for (const [question, id] of cases) {
      if (
        documents.some((doc) =>
          doc.raw.toLowerCase().includes(question.toLowerCase()),
        )
      )
        baseline++;
      const packet = retrieveWikiEvidence(documents, question);
      if (packet.results.some((row) => row.id === id)) retrieved++;
      expect(packet.results.some((row) => row.id === id)).toBe(true);
      for (const row of packet.results) {
        const doc = documents.find((doc) => doc.id === row.id)!;
        expect(row.excerpt).toBe(
          doc.raw
            .split(/\r?\n/u)
            .slice(row.provenance.start - 1, row.provenance.end)
            .join("\n"),
        );
        expect(row.provenance.hash).toMatch(/^[a-f0-9]{64}$/u);
      }
    }
    console.log(
      JSON.stringify({
        fixtureQuestions: cases.length,
        wholeQuestionSubstringHits: baseline,
        retrievalHitsAt5: retrieved,
      }),
    );
    expect(baseline).toBe(0);
  });
  test("no evidence stays empty and context is bounded across long documents", () => {
    expect(
      retrieveWikiEvidence(documents, "unrelateduniqueidentifier").results,
    ).toEqual([]);
    const long = Array.from({ length: 20 }, (_, i) => ({
      id: `guide-${i}`,
      title: "Checkout",
      raw: Array.from(
        { length: 1000 },
        (_, n) => `Checkout note ${n} ${"detail ".repeat(10)}`,
      ).join("\n"),
    }));
    const packet = retrieveWikiEvidence(long, "Checkout note");
    expect(packet.results.length).toBeLessThanOrEqual(5);
    expect(packet.retrieval.returnedCharacters).toBeLessThanOrEqual(10000);
    expect(packet.truncated).toBe(true);
    for (const doc of long)
      expect(
        packet.results.filter((row) => row.id === doc.id).length,
      ).toBeLessThanOrEqual(2);
  });
});
