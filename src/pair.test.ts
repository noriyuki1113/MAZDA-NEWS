import { describe, expect, it, vi } from "vitest";
import type { ReleaseListItem } from "./fetch.js";
import {
  computePendingUntil,
  confirmJaOnly,
  isPendingExpired,
  jaUrlToEnUrl,
  pairReleases,
} from "./pair.js";

function item(
  lang: "ja" | "en",
  releaseId: string,
  overrides: Partial<ReleaseListItem> = {},
): ReleaseListItem {
  const yy = releaseId.slice(0, 2);
  const mm = releaseId.slice(2, 4);
  const dd = releaseId.slice(4, 6);
  return {
    releaseId,
    url: `https://newsroom.mazda.com/${lang}/publicity/release/20${yy}/20${yy}${mm}/${releaseId}.html`,
    title: `title-${releaseId}`,
    category: "クルマ・技術",
    publishedAt: `20${yy}-${mm}-${dd}`,
    lang,
    ...overrides,
  };
}

describe("pairReleases", () => {
  it("classifies ja_only / paired / en_only per §4.1", () => {
    const jaItems = [item("ja", "260901a"), item("ja", "260901b"), item("ja", "260828a")];
    const enItems = [item("en", "260901a"), item("en", "260806a")];

    const results = pairReleases(jaItems, enItems);
    const byId = new Map(results.map((r) => [r.releaseId, r]));

    expect(byId.get("260901a")).toMatchObject({ status: "paired" });
    expect(byId.get("260901b")).toMatchObject({ status: "ja_only", urlEn: null });
    expect(byId.get("260828a")).toMatchObject({ status: "ja_only", urlEn: null });
    expect(byId.get("260806a")).toMatchObject({ status: "en_only", urlJa: null });
    expect(results).toHaveLength(4);
  });

  it("keeps both urls for a paired release", () => {
    const ja = item("ja", "260901a");
    const en = item("en", "260901a");
    const [result] = pairReleases([ja], [en]);
    expect(result).toMatchObject({
      releaseId: "260901a",
      status: "paired",
      urlJa: ja.url,
      urlEn: en.url,
    });
  });

  it("returns an empty array when both lists are empty", () => {
    expect(pairReleases([], [])).toEqual([]);
  });
});

describe("jaUrlToEnUrl", () => {
  it("swaps /ja/publicity/release/ for /en/publicity/release/", () => {
    expect(
      jaUrlToEnUrl("https://newsroom.mazda.com/ja/publicity/release/2026/202609/260901b.html"),
    ).toBe("https://newsroom.mazda.com/en/publicity/release/2026/202609/260901b.html");
  });
});

describe("confirmJaOnly", () => {
  it("upgrades ja_only to paired when the mirrored English URL exists (§4.1)", async () => {
    const candidate = pairReleases([item("ja", "260901b")], [])[0];
    const checkExists = vi.fn().mockResolvedValue(true);

    const result = await confirmJaOnly(candidate, checkExists);

    expect(result.status).toBe("paired");
    expect(result.urlEn).toBe(jaUrlToEnUrl(candidate.urlJa!));
    expect(checkExists).toHaveBeenCalledWith(jaUrlToEnUrl(candidate.urlJa!));
  });

  it("stays ja_only when the mirrored English URL does not exist", async () => {
    const candidate = pairReleases([item("ja", "260901b")], [])[0];
    const checkExists = vi.fn().mockResolvedValue(false);

    const result = await confirmJaOnly(candidate, checkExists);

    expect(result).toEqual(candidate);
  });

  it("does not call checkExists for an already-paired release", async () => {
    const candidate = pairReleases([item("ja", "260901a")], [item("en", "260901a")])[0];
    const checkExists = vi.fn().mockResolvedValue(false);

    const result = await confirmJaOnly(candidate, checkExists);

    expect(checkExists).not.toHaveBeenCalled();
    expect(result).toEqual(candidate);
  });

  it("does not call checkExists for an en_only release", async () => {
    const candidate = pairReleases([], [item("en", "260806a")])[0];
    const checkExists = vi.fn().mockResolvedValue(true);

    const result = await confirmJaOnly(candidate, checkExists);

    expect(checkExists).not.toHaveBeenCalled();
    expect(result).toEqual(candidate);
  });
});

describe("pending window (§4.2)", () => {
  it("computePendingUntil adds 14 days to first_seen_at", () => {
    const firstSeen = new Date("2026-09-01T08:00:00Z");
    expect(computePendingUntil(firstSeen).toISOString()).toBe("2026-09-15T08:00:00.000Z");
  });

  it("isPendingExpired is false before the deadline and true on/after it", () => {
    const pendingUntil = new Date("2026-09-15T08:00:00Z");
    expect(isPendingExpired(pendingUntil, new Date("2026-09-14T23:59:59Z"))).toBe(false);
    expect(isPendingExpired(pendingUntil, new Date("2026-09-15T08:00:00Z"))).toBe(true);
    expect(isPendingExpired(pendingUntil, new Date("2026-09-20T00:00:00Z"))).toBe(true);
  });
});
