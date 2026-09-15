import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

// mazda-news-spec.md §5.1 の data/seen.json の読み書き。

export type PairStatus = "ja_only" | "ja_only_confirmed" | "paired" | "en_only";
export type ExcludedReason = "category" | "pdf" | null;

export interface SeenItem {
  releaseId: string;
  urlJa: string | null;
  urlEn: string | null;
  titleJa: string | null;
  titleEn: string | null;
  category: string;
  publishedAt: string; // YYYY-MM-DD
  firstSeenAt: string; // ISO 8601
  pairStatus: PairStatus;
  pendingUntil: string | null; // YYYY-MM-DD, ja_onlyのときのみ
  excluded: boolean;
  excludedReason: ExcludedReason;
  summarized: boolean;
}

export interface SeenStore {
  version: number;
  items: SeenItem[];
}

const SEEN_VERSION = 2;
const RETENTION_DAYS = 365;

export function emptyStore(): SeenStore {
  return { version: SEEN_VERSION, items: [] };
}

export function findByReleaseId(store: SeenStore, releaseId: string): SeenItem | undefined {
  return store.items.find((item) => item.releaseId === releaseId);
}

export function upsertItem(store: SeenStore, item: SeenItem): SeenStore {
  const idx = store.items.findIndex((i) => i.releaseId === item.releaseId);
  if (idx === -1) return { ...store, items: [...store.items, item] };
  const items = store.items.slice();
  items[idx] = item;
  return { ...store, items };
}

// 直近365日分のみ保持する（公開日ベース）。
export function pruneOld(store: SeenStore, now: Date = new Date()): SeenStore {
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - RETENTION_DAYS);
  return {
    version: SEEN_VERSION,
    items: store.items.filter((item) => new Date(`${item.publishedAt}T00:00:00Z`) >= cutoff),
  };
}

export async function loadSeenStore(path: string): Promise<SeenStore> {
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw) as SeenStore;
    return { version: parsed.version ?? SEEN_VERSION, items: parsed.items ?? [] };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return emptyStore();
    throw err;
  }
}

// 一時ファイル経由のアトミック書き込み（§5.1）。書き込み前に365日超のものを削除する。
export async function saveSeenStore(
  path: string,
  store: SeenStore,
  now: Date = new Date(),
): Promise<void> {
  const pruned = pruneOld(store, now);
  await mkdir(dirname(path), { recursive: true });
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmpPath, JSON.stringify(pruned, null, 2) + "\n", "utf-8");
  await rename(tmpPath, path);
}
