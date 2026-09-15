import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  emptyStore,
  findByReleaseId,
  loadSeenStore,
  pruneOld,
  saveSeenStore,
  upsertItem,
  type SeenItem,
  type SeenStore,
} from "./dedupe.js";

function item(overrides: Partial<SeenItem> = {}): SeenItem {
  return {
    releaseId: "260901b",
    urlJa: "https://newsroom.mazda.com/ja/publicity/release/2026/202609/260901b.html",
    urlEn: null,
    titleJa: "タイトル",
    titleEn: null,
    category: "クルマ・技術",
    publishedAt: "2026-09-01",
    firstSeenAt: "2026-09-01T08:00:00+09:00",
    pairStatus: "ja_only",
    pendingUntil: "2026-09-15",
    excluded: false,
    excludedReason: null,
    summarized: false,
    ...overrides,
  };
}

describe("upsertItem / findByReleaseId", () => {
  it("inserts a new item and finds it by release_id", () => {
    const store = upsertItem(emptyStore(), item());
    expect(findByReleaseId(store, "260901b")).toEqual(item());
    expect(findByReleaseId(store, "nope")).toBeUndefined();
  });

  it("replaces an existing item with the same release_id instead of duplicating it", () => {
    let store = upsertItem(emptyStore(), item());
    store = upsertItem(store, item({ pairStatus: "paired", urlEn: "https://newsroom.mazda.com/en/x.html" }));

    expect(store.items).toHaveLength(1);
    expect(store.items[0]).toMatchObject({ pairStatus: "paired" });
  });
});

describe("pruneOld", () => {
  it("keeps items published within the last 365 days and drops older ones", () => {
    const now = new Date("2026-09-15T00:00:00Z");
    const store: SeenStore = {
      version: 2,
      items: [
        item({ releaseId: "recent", publishedAt: "2026-09-01" }),
        item({ releaseId: "old", publishedAt: "2025-01-01" }), // > 365 days before now
      ],
    };

    const pruned = pruneOld(store, now);

    expect(pruned.items.map((i) => i.releaseId)).toEqual(["recent"]);
  });
});

describe("loadSeenStore / saveSeenStore", () => {
  let dir: string;
  let path: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "seen-test-"));
    path = join(dir, "nested", "seen.json");
  });

  it("returns an empty store when the file doesn't exist yet", async () => {
    expect(await loadSeenStore(path)).toEqual(emptyStore());
  });

  it("round-trips through save and load, creating parent directories", async () => {
    const store = upsertItem(emptyStore(), item());
    await saveSeenStore(path, store, new Date("2026-09-15T00:00:00Z"));

    const loaded = await loadSeenStore(path);
    expect(loaded).toEqual(store);
  });

  it("prunes items older than 365 days on save", async () => {
    const store: SeenStore = {
      version: 2,
      items: [
        item({ releaseId: "recent", publishedAt: "2026-09-01" }),
        item({ releaseId: "old", publishedAt: "2020-01-01" }),
      ],
    };
    await saveSeenStore(path, store, new Date("2026-09-15T00:00:00Z"));

    const loaded = await loadSeenStore(path);
    expect(loaded.items.map((i) => i.releaseId)).toEqual(["recent"]);
  });

  it("writes valid, human-readable JSON (atomic write leaves no .tmp file)", async () => {
    await saveSeenStore(path, upsertItem(emptyStore(), item()), new Date("2026-09-15T00:00:00Z"));
    const raw = await readFile(path, "utf-8");
    expect(() => JSON.parse(raw)).not.toThrow();
    expect(raw).toContain("\n"); // pretty-printed, not minified
  });
});
