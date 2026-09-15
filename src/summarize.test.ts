import { describe, expect, it, vi } from "vitest";
import { summarizeArticle } from "./summarize.js";

const VALID_JSON = JSON.stringify({
  headline: "Mazda Roadster gets a mid-cycle refresh",
  summary: "Sentence one. Sentence two. Sentence three.",
  why_it_matters: "It shows Mazda is still investing in the Roadster.",
  tags: ["JDM-only", "special-edition"],
});

const INPUT = { title: "マツダ、ロードスターを商品改良", bodyText: "本文..." };

describe("summarizeArticle", () => {
  it("returns the parsed summary on a valid JSON response", async () => {
    const complete = vi.fn().mockResolvedValue(VALID_JSON);

    const result = await summarizeArticle(INPUT, complete);

    expect(result).toEqual({
      headline: "Mazda Roadster gets a mid-cycle refresh",
      summary: "Sentence one. Sentence two. Sentence three.",
      whyItMatters: "It shows Mazda is still investing in the Roadster.",
      tags: ["JDM-only", "special-edition"],
    });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledWith(INPUT);
  });

  it("strips an accidental markdown fence before parsing", async () => {
    const complete = vi.fn().mockResolvedValue("```json\n" + VALID_JSON + "\n```");

    const result = await summarizeArticle(INPUT, complete);

    expect(result?.headline).toBe("Mazda Roadster gets a mid-cycle refresh");
  });

  it("retries once on invalid JSON and succeeds on the second attempt (§7)", async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce("not json at all")
      .mockResolvedValueOnce(VALID_JSON);

    const result = await summarizeArticle(INPUT, complete);

    expect(result).not.toBeNull();
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("retries once when a required field is missing, then succeeds", async () => {
    const missingField = JSON.stringify({
      headline: "Headline",
      summary: "Summary",
      tags: [],
      // why_it_matters missing
    });
    const complete = vi.fn().mockResolvedValueOnce(missingField).mockResolvedValueOnce(VALID_JSON);

    const result = await summarizeArticle(INPUT, complete);

    expect(result?.headline).toBe("Mazda Roadster gets a mid-cycle refresh");
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("skips the article (returns null) after two consecutive failures", async () => {
    const complete = vi.fn().mockResolvedValue("still not json");

    const result = await summarizeArticle(INPUT, complete);

    expect(result).toBeNull();
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("returns null without exceeding two attempts when the API call itself rejects", async () => {
    const complete = vi.fn().mockRejectedValue(new Error("network error"));

    const result = await summarizeArticle(INPUT, complete);

    expect(result).toBeNull();
    expect(complete).toHaveBeenCalledTimes(2);
  });
});
