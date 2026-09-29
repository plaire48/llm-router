// Local ingestion budgets are independent of model context and bounded reads.
export const ATTACHMENT_LIMITS = Object.freeze({count: 4, imageBytes: 4 * 1024 * 1024,
  textBytes: 8 * 1024 * 1024, documentBytes: 8 * 1024 * 1024,
  textChars: 4_000_000, extractedBytes: 12 * 1024 * 1024, documentPages: 2000,
  extractionMs: 120000, researchCharacters: 8_000_000,
  batchBytes: 8 * 1024 * 1024, storedCount: 80, storedBytes: 80 * 1024 * 1024});
