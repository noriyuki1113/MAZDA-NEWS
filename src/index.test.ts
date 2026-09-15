import { describe, expect, it, vi } from "vitest";
import type { ReleaseListItem } from "./fetch.js";
import type { PairedRelease } from "./pair.js";
import type { SeenItem } from "./dedupe.js";
import { classifyNewRelease, reviewPendingItem, selectSummaryTargets } from "./index.js";

function listItem(lang: "ja" | "en", overrides: Partial<ReleaseListItem> = {}): ReleaseListItem {
  return {
    releaseId: "260901b",
    url: `https://newsroom.mazda.com/${lang}/publicity/release/2026/202609/260901b.html`,
    title: "タイトル",
    category: "クルマ・技術",
    publishedAt: "2026-09-01",
    lang,
    ...overrides,
  };
}

function seenItem(overrides: Partial<SeenItem> = {}): SeenItem {
  return {
    releaseId: "260901b",
    urlJa: "https://newsroom.mazda.com/ja/publicity/release/2026/202609/260901b.html",
    urlEn: null,
    titleJa: "タイトル",
    titleEn: null,
    category: "クルマ・技術",
    publishedAt: "2026-09-01",
    firstSeenAt: "2026-09-01T08:00:00.000Z",
    pairStatus: "ja_only",
    pendingUntil: "2026-09-15",
    excluded: false,
    excludedReason: null,
    summarized: false,
    ...overrides,
  };
}

describe("classifyNewRelease", () => {
  const now = new Date("2026-09-01T08:00:00Z");

  it("classifies a ja_only release, setting pending_until 14 days out (§4.2)", () => {
    const ja = listItem("ja");
    const result: PairedRelease = {
      releaseId: "260901b",
      status: "ja_only",
      urlJa: ja.url,
      urlEn: null,
      publishedAt: "2026-09-01",
    };

    const item = classifyNewRelease(result, new Map([["260901b", ja]]), new Map(), now);

    expect(item).toMatchObject({
      releaseId: "260901b",
      pairStatus: "ja_only",
      pendingUntil: "2026-09-15",
      excluded: false,
      excludedReason: null,
      summarized: false,
    });
  });

  it("does not set pending_until for a paired release", () => {
    const ja = listItem("ja");
    const en = listItem("en");
    const result: PairedRelease = {
      releaseId: "260901b",
      status: "paired",
      urlJa: ja.url,
      urlEn: en.url,
      publishedAt: "2026-09-01",
    };

    const item = classifyNewRelease(
      result,
      new Map([["260901b", ja]]),
      new Map([["260901b", en]]),
      now,
    );

    expect(item.pendingUntil).toBeNull();
  });

  it("marks a fully-excluded category (株主・投資家情報) as excluded (§3.7)", () => {
    const ja = listItem("ja", { category: "株主・投資家情報", title: "2026年度決算発表" });
    const result: PairedRelease = {
      releaseId: "260901b",
      status: "ja_only",
      urlJa: ja.url,
      urlEn: null,
      publishedAt: "2026-09-01",
    };

    const item = classifyNewRelease(result, new Map([["260901b", ja]]), new Map(), now);

    expect(item.excluded).toBe(true);
    expect(item.excludedReason).toBe("category");
  });

  it("marks a PDF-only release as excluded with reason 'pdf' (§3.6)", () => {
    const ja = listItem("ja", {
      title: "何か[PDF形式]",
      url: "https://newsroom.mazda.com/ja/publicity/release/2026/202609/260901b.pdf",
    });
    const result: PairedRelease = {
      releaseId: "260901b",
      status: "ja_only",
      urlJa: ja.url,
      urlEn: null,
      publishedAt: "2026-09-01",
    };

    const item = classifyNewRelease(result, new Map([["260901b", ja]]), new Map(), now);

    expect(item.excluded).toBe(true);
    expect(item.excludedReason).toBe("pdf");
  });
});

describe("reviewPendingItem", () => {
  const now = new Date("2026-09-20T00:00:00Z");

  it("leaves a non-ja_only item untouched", async () => {
    const item = seenItem({ pairStatus: "paired", pendingUntil: null });
    const checkExists = vi.fn();

    const result = await reviewPendingItem(item, now, checkExists);

    expect(result).toEqual({ updated: item, promoted: false });
    expect(checkExists).not.toHaveBeenCalled();
  });

  it("confirms to ja_only_confirmed once pending_until has passed, without a network check", async () => {
    const item = seenItem({ pendingUntil: "2026-09-15" }); // now (09-20) is after this
    const checkExists = vi.fn();

    const result = await reviewPendingItem(item, now, checkExists);

    expect(result.updated.pairStatus).toBe("ja_only_confirmed");
    expect(result.promoted).toBe(false);
    expect(checkExists).not.toHaveBeenCalled();
  });

  it("promotes to paired when the English URL now exists, within the pending window", async () => {
    const item = seenItem({ pendingUntil: "2026-09-25" }); // still in the future
    const checkExists = vi.fn().mockResolvedValue(true);

    const result = await reviewPendingItem(item, now, checkExists);

    expect(result.promoted).toBe(true);
    expect(result.updated.pairStatus).toBe("paired");
    expect(result.updated.pendingUntil).toBeNull();
    expect(result.updated.urlEn).not.toBeNull();
  });

  it("stays ja_only when still pending and the English URL doesn't exist yet", async () => {
    const item = seenItem({ pendingUntil: "2026-09-25" });
    const checkExists = vi.fn().mockResolvedValue(false);

    const result = await reviewPendingItem(item, now, checkExists);

    expect(result.promoted).toBe(false);
    expect(result.updated).toEqual(item);
  });
});

describe("selectSummaryTargets", () => {
  it("only includes unsummarized, non-excluded ja_only items, oldest first", () => {
    const items = [
      seenItem({ releaseId: "c", publishedAt: "2026-09-03" }),
      seenItem({ releaseId: "a", publishedAt: "2026-09-01" }),
      seenItem({ releaseId: "b", publishedAt: "2026-09-02" }),
      seenItem({ releaseId: "excluded", publishedAt: "2026-08-01", excluded: true }),
      seenItem({ releaseId: "paired", publishedAt: "2026-08-01", pairStatus: "paired" }),
      seenItem({ releaseId: "done", publishedAt: "2026-08-01", summarized: true }),
    ];

    const targets = selectSummaryTargets(items);

    expect(targets.map((i) => i.releaseId)).toEqual(["a", "b", "c"]);
  });

  it("caps at the given limit (default 10, §6/§12)", () => {
    const items = Array.from({ length: 15 }, (_, i) =>
      seenItem({
        releaseId: `r${i}`,
        publishedAt: `2026-09-${String(i + 1).padStart(2, "0")}`,
      }),
    );

    const targets = selectSummaryTargets(items);

    expect(targets).toHaveLength(10);
    expect(targets[0].releaseId).toBe("r0");
    expect(targets[9].releaseId).toBe("r9");
  });
});
