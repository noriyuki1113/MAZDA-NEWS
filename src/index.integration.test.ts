import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReleaseListItem } from "./fetch.js";
import type { SeenItem, SeenStore } from "./dedupe.js";

const fetchListMock = vi.fn();
const fetchArticleMock = vi.fn();
const loadSeenStoreMock = vi.fn();
const saveSeenStoreMock = vi.fn();
const summarizeArticleMock = vi.fn();
const writeFileMock = vi.fn().mockResolvedValue(undefined);
const mkdirMock = vi.fn().mockResolvedValue(undefined);

vi.mock("./fetch.js", () => ({
  fetchList: fetchListMock,
  fetchArticle: fetchArticleMock,
}));

vi.mock("./dedupe.js", async () => {
  const actual = await vi.importActual<typeof import("./dedupe.js")>("./dedupe.js");
  return { ...actual, loadSeenStore: loadSeenStoreMock, saveSeenStore: saveSeenStoreMock };
});

vi.mock("./summarize.js", async () => {
  const actual = await vi.importActual<typeof import("./summarize.js")>("./summarize.js");
  return { ...actual, summarizeArticle: summarizeArticleMock };
});

vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  return { ...actual, writeFile: writeFileMock, mkdir: mkdirMock };
});

const { main } = await import("./index.js");
const { emptyStore, upsertItem } = await import("./dedupe.js");

function listItem(lang: "ja" | "en", releaseId: string, category = "クルマ・技術"): ReleaseListItem {
  const yy = releaseId.slice(0, 2);
  const mm = releaseId.slice(2, 4);
  const dd = releaseId.slice(4, 6);
  return {
    releaseId,
    url: `https://newsroom.mazda.com/${lang}/publicity/release/20${yy}/20${yy}${mm}/${releaseId}.html`,
    title: `title-${releaseId}`,
    category,
    publishedAt: `20${yy}-${mm}-${dd}`,
    lang,
  };
}

function seenItemFor(item: ReleaseListItem): SeenItem {
  return {
    releaseId: item.releaseId,
    urlJa: item.url,
    urlEn: null,
    titleJa: item.title,
    titleEn: null,
    category: item.category,
    publishedAt: item.publishedAt,
    firstSeenAt: "2026-09-01T08:00:00.000Z",
    pairStatus: "ja_only",
    pendingUntil: "2026-09-15",
    excluded: false,
    excludedReason: null,
    summarized: true,
  };
}

const NOW = new Date("2026-09-15T08:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

async function runMain() {
  const promise = main(NOW);
  await vi.runAllTimersAsync();
  await promise;
}

describe("main() — §12 acceptance criteria", () => {
  it("does not write a draft when there are no new distributable items, but still saves seen.json", async () => {
    const already = listItem("ja", "260901a");
    fetchListMock.mockResolvedValueOnce([already]).mockResolvedValueOnce([]);
    const store: SeenStore = upsertItem(emptyStore(), seenItemFor(already));
    loadSeenStoreMock.mockResolvedValue(store);

    await runMain();

    expect(writeFileMock).not.toHaveBeenCalled();
    expect(saveSeenStoreMock).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBeFalsy();
  });

  it("aborts without touching seen.json when the English list fetch fails (§6)", async () => {
    fetchListMock
      .mockResolvedValueOnce([listItem("ja", "260901a")])
      .mockRejectedValueOnce(new Error("HTTP 500"));

    await runMain();

    expect(saveSeenStoreMock).not.toHaveBeenCalled();
    expect(writeFileMock).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    process.exitCode = 0; // reset for other tests in this run
  });

  it("aborts without touching seen.json when the Japanese list fetch fails", async () => {
    fetchListMock.mockRejectedValueOnce(new Error("HTTP 500"));

    await runMain();

    expect(saveSeenStoreMock).not.toHaveBeenCalled();
    expect(fetchListMock).toHaveBeenCalledTimes(1); // never even tries the en list
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });

  it("does not write an empty draft when a new ja_only item is detected but summarization fails for all of it (regression: incident 2026-10-05)", async () => {
    // 2026-09-24〜10-05に実際に起きた不具合の再現。newJaOnly等の"検出時点での件数"
    // だけで配信有無を決めると、記事取得/要約が全件失敗した日でも空のdraftが
    // 書かれてPRが立ってしまう。要約後の実件数で判定しないといけない。
    const jaItem = listItem("ja", "261006a");
    fetchListMock.mockResolvedValueOnce([jaItem]).mockResolvedValueOnce([]);
    loadSeenStoreMock.mockResolvedValue(emptyStore());
    fetchArticleMock.mockResolvedValue({ title: jaItem.title, bodyText: "本文" });
    summarizeArticleMock.mockResolvedValue(null); // §7: 2回失敗してスキップ

    const fetchSpy = vi.fn().mockResolvedValue({ ok: false }); // HEAD確認: 英語版なし
    vi.stubGlobal("fetch", fetchSpy);

    try {
      await runMain();
    } finally {
      vi.unstubAllGlobals();
    }

    expect(writeFileMock).not.toHaveBeenCalled();
    expect(saveSeenStoreMock).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBeFalsy();
  });
});
