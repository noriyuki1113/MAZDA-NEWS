import { USER_AGENT } from "./sources.js";
import type { ReleaseListItem } from "./fetch.js";

// mazda-news-spec.md §4 の日英突き合わせロジック。本プロジェクトの核。

export type PairStatus = "ja_only" | "paired" | "en_only";

export interface PairedRelease {
  releaseId: string;
  status: PairStatus;
  urlJa: string | null;
  urlEn: string | null;
  publishedAt: string;
}

// §4.1 手順1〜5:
//   id ∈ JA かつ id ∉ EN → ja_only
//   id ∈ JA かつ id ∈ EN → paired
//   id ∉ JA かつ id ∈ EN → en_only (記録のみ、配信しない)
export function pairReleases(
  jaItems: ReleaseListItem[],
  enItems: ReleaseListItem[],
): PairedRelease[] {
  const enById = new Map(enItems.map((item) => [item.releaseId, item]));
  const jaById = new Map(jaItems.map((item) => [item.releaseId, item]));
  const results: PairedRelease[] = [];

  for (const ja of jaItems) {
    const en = enById.get(ja.releaseId);
    results.push({
      releaseId: ja.releaseId,
      status: en ? "paired" : "ja_only",
      urlJa: ja.url,
      urlEn: en?.url ?? null,
      publishedAt: ja.publishedAt,
    });
  }

  for (const en of enItems) {
    if (!jaById.has(en.releaseId)) {
      results.push({
        releaseId: en.releaseId,
        status: "en_only",
        urlJa: null,
        urlEn: en.url,
        publishedAt: en.publishedAt,
      });
    }
  }

  return results;
}

export function jaUrlToEnUrl(urlJa: string): string {
  return urlJa.replace("/ja/publicity/release/", "/en/publicity/release/");
}

async function headRequestOk(url: string): Promise<boolean> {
  const res = await fetch(url, { method: "HEAD", headers: { "User-Agent": USER_AGENT } });
  return res.ok;
}

// §4.1 追加確認: 英語一覧に載っていなくても /en/ のURLが存在する場合があるため、
// ja_only判定の確定前に対応する英語URLへHEADリクエストを1回投げて確認する。
// 200ならpairedに降格。すでにpaired/en_onlyのものは何もしない。
export async function confirmJaOnly(
  candidate: PairedRelease,
  checkExists: (url: string) => Promise<boolean> = headRequestOk,
): Promise<PairedRelease> {
  if (candidate.status !== "ja_only" || !candidate.urlJa) return candidate;

  const urlEn = jaUrlToEnUrl(candidate.urlJa);
  const exists = await checkExists(urlEn);
  if (!exists) return candidate;

  return { ...candidate, status: "paired", urlEn };
}

// §4.2 遅延公開への対応。
// ja_only と判定したものは、初回検出(first_seen_at)から14日後を pending_until とし、
// その期間内は毎日英語URLの存在を再確認する。14日経っても出なければ ja_only_confirmed
// として確定する（この状態自体は data/seen.json 側の pair_status が持つ。§5.1）。
const PENDING_DAYS = 14;

export function computePendingUntil(firstSeenAt: Date): Date {
  const pendingUntil = new Date(firstSeenAt);
  pendingUntil.setUTCDate(pendingUntil.getUTCDate() + PENDING_DAYS);
  return pendingUntil;
}

export function isPendingExpired(pendingUntil: Date, now: Date = new Date()): boolean {
  return now.getTime() >= pendingUntil.getTime();
}
